// packages/client/lib/ws-client.ts
import { proxyRequest } from "./http-proxy";

const CONNECT_TIMEOUT_MS = 10_000;
const CONTROL_HEARTBEAT_TIMEOUT_MS = 45_000;
const CONTROL_HEARTBEAT_CHECK_MS = 15_000;
const LOCAL_WS_OPEN_TIMEOUT_MS = 10_000;

export interface TunnelClientOptions {
  serverUrl: string;
  token: string;
  localHost: string;
  localPort: number;
  hostHeader?: string;
  requestedSubdomain?: string;
  force?: boolean;
  onConnected?: (url: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRequest?: (method: string, path: string) => void;
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

interface LocalWsEntry {
  socket: WebSocket;
  openTimer: Timer | null;
  serverNotified: boolean;
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private options: TunnelClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private localWebSockets = new Map<string, LocalWsEntry>();
  private pendingRequestControllers = new Map<string, { controller: AbortController; ws: WebSocket | null }>();
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private lastServerMessageAt = 0;
  constructor(options: TunnelClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let settled = false;

    const ws = new WebSocket(this.options.serverUrl);
    this.ws = ws;

    const connectTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        this.ws?.close();
        reject(new Error("WebSocket auth timeout"));
      }
    }, CONNECT_TIMEOUT_MS);

    this.ws.onopen = () => {
      // Send auth message
      const authMessage: { type: string; token: string; requestedSubdomain?: string; force?: boolean } = {
        type: "auth",
        token: this.options.token,
      };
      if (this.options.requestedSubdomain) {
        authMessage.requestedSubdomain = this.options.requestedSubdomain;
      }
      if (this.options.force) {
        authMessage.force = true;
      }
      this.ws?.send(JSON.stringify(authMessage));
    };

    this.ws.onmessage = async (event) => {
      this.lastServerMessageAt = Date.now();
      const msg = JSON.parse(event.data) as ServerMessage;

      if (msg.type === "auth_ok") {
        // Sticky-reclaim the assigned subdomain on future reconnects so the
        // public URL stays stable even when started without --uri.
        if (typeof msg.subdomain === "string" && msg.subdomain) {
          this.options.requestedSubdomain = msg.subdomain;
        }
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        this.reconnectAttempts = 0;
        const url = msg.url as string;
        this.options.onConnected?.(url);
        this.startHeartbeatWatchdog();
        resolve();
        return;
      }

      if (msg.type === "auth_error") {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        const error = new Error(msg.message as string);
        this.options.onError?.(error);
        this.shouldReconnect = false;
        reject(error);
        return;
      }

      if (msg.type === "request") {
        await this.handleRequest(msg);
      }

      if (msg.type === "ws_open") {
        this.handleWSOpen(msg.requestId as string, msg.path as string, msg.headers as Record<string, string | string[]> | undefined);
      }

      if (msg.type === "ws_data") {
        this.handleWSData(msg.requestId as string, msg.data as string);
      }

      if (msg.type === "ws_close") {
        this.handleWSClose(msg.requestId as string);
      }

      if (msg.type === "ping") {
        // Respond to server keepalive ping
        this.ws?.send(JSON.stringify({ type: "pong" }));
      }
    };

    this.ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        reject(new Error("WebSocket connection error"));
      }
      this.options.onError?.(new Error("WebSocket error"));
    };

    this.ws.onclose = () => {
      this.stopHeartbeatWatchdog();
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        reject(new Error("WebSocket closed before auth"));
      }

      // Close all local WebSocket bridges before attempting reconnect
      for (const [_requestId, entry] of this.localWebSockets) {
        clearTimeout(entry.openTimer);
        try { entry.socket.close(); } catch { /* ignore */ }
      }
      this.localWebSockets.clear();

      const closingWs = ws;
      for (const [requestId, entry] of this.pendingRequestControllers) {
        if (entry.ws === closingWs) {
          entry.controller.abort();
          this.pendingRequestControllers.delete(requestId);
        }
      }

      this.options.onDisconnected?.();
      if (this.shouldReconnect) {
        this.attemptReconnect();
      }
    };

    return promise;
  }

  private async handleRequest(msg: ServerMessage): Promise<void> {
    const requestId = msg.requestId as string;
    const method = msg.method as string;
    const path = msg.path as string;
    const headers = msg.headers as Record<string, string | string[]>;
    const body = msg.body as string;

    const controlWs = this.ws;
    if (!controlWs || controlWs.readyState !== WebSocket.OPEN) {
      console.error(
        `[tunnel-client] handleRequest silently dropped: requestId=${requestId} method=${method} path=${path} ` +
        `ws=${controlWs ? `readyState=${controlWs.readyState}` : "null"} this.ws=${this.ws ? `readyState=${this.ws.readyState}` : "null"}`,
      );
      return;
    }

    console.log(`[tunnel-client] Handling request: ${method} ${path} (requestId=${requestId})`);

    this.options.onRequest?.(method, path);

    const abortController = new AbortController();
    this.pendingRequestControllers.set(requestId, { controller: abortController, ws: controlWs });
    let loggedSendDrop = false;
    const sendJson = (msg: object): void => {
      // Send on the captured socket only; if it was replaced by reconnect,
      // the server already rejected pending requests — sending on the new
      // socket would be silently ignored.
      const trySend = (ws: WebSocket | null): boolean => {
        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(msg));
            return true;
          } catch {
            // TOCTOU: socket closed between check and send
          }
        }
        return false;
      };

      if (trySend(controlWs)) return;

      if (loggedSendDrop) return;
      loggedSendDrop = true;
      const msgType = typeof msg === "object" && msg !== null && "type" in msg
        ? String((msg as Record<string, unknown>).type)
        : "unknown";
      console.error(
        `[tunnel-client] sendJson dropped ${msgType} for requestId=${requestId}: ` +
        `controlWs===this.ws=${controlWs === this.ws} ` +
        `controlWs.readyState=${controlWs?.readyState ?? "null"} ` +
        `this.ws.readyState=${this.ws?.readyState ?? "null"}`,
      );
    };

    try {
      for await (const part of proxyRequest({
        host: this.options.localHost,
        port: this.options.localPort,
        method,
        path,
        headers,
        body,
        hostHeader: this.options.hostHeader,
        signal: abortController.signal,
      })) {
        if (part.type === "head") {
          sendJson({
            type: "response_head",
            requestId,
            status: part.status,
            headers: part.headers,
          });
        } else if (part.type === "data") {
          sendJson({
            type: "response_data",
            requestId,
            data: part.data,
          });
        } else if (part.type === "end") {
          sendJson({
            type: "response_end",
            requestId,
          });
        }
      }
    } finally {
      this.pendingRequestControllers.delete(requestId);
    }
  }

  private notifyServerWSClose(requestId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ws_close", requestId }));
    }
  }

  private handleWSOpen(requestId: string, path: string, incomingHeaders: Record<string, string | string[]> = {}): void {
    console.log(`[tunnel-client] WS open: requestId=${requestId} path=${path}`);
    this.options.onRequest?.("WS", path);

    const url = `ws://${this.options.localHost}:${this.options.localPort}${path}`;

    // Skip hop-by-hop and WebSocket-generated headers
    const skipHeaders: Record<string, true> = {
      host: true,
      connection: true,
      "keep-alive": true,
      "transfer-encoding": true,
      upgrade: true,
      "proxy-connection": true,
      "proxy-authenticate": true,
      "proxy-authorization": true,
      "sec-websocket-key": true,
      "sec-websocket-version": true,
      "sec-websocket-extensions": true,
      "sec-websocket-accept": true,
    };
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(incomingHeaders)) {
      if (!skipHeaders[key.toLowerCase()]) {
        // WS headers don't support arrays; join multi-value with "; "
        headers[key] = Array.isArray(value) ? value.join("; ") : value;
      }
    }
    headers["host"] = this.options.hostHeader || `${this.options.localHost}:${this.options.localPort}`;

    const localWs = new WebSocket(url, { headers } as unknown as string | string[]);
    const entry: LocalWsEntry = {
      socket: localWs,
      openTimer: null,
      serverNotified: false,
    };

    entry.openTimer = setTimeout(() => {
      if (!entry.serverNotified) {
        entry.serverNotified = true;
        this.notifyServerWSClose(requestId);
      }
      try { localWs.close(); } catch { /* ignore */ }
      this.localWebSockets.delete(requestId);
    }, LOCAL_WS_OPEN_TIMEOUT_MS);

    localWs.onopen = () => {
      if (entry.openTimer) {
        clearTimeout(entry.openTimer);
        entry.openTimer = null;
      }
      this.ws?.send(JSON.stringify({
        type: "ws_ready",
        requestId,
      }));
    };

    localWs.onmessage = async (event) => {
      const data = event.data;
      let buffer: Buffer;
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        const arrayBuffer = await data.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        buffer = Buffer.from(typeof data === "string" ? data : data);
      }
      const base64Data = buffer.toString("base64");
      this.ws?.send(JSON.stringify({
        type: "ws_data",
        requestId,
        data: base64Data,
      }));
    };

    localWs.onerror = () => {
      if (!entry.serverNotified) {
        entry.serverNotified = true;
        this.notifyServerWSClose(requestId);
      }
      try { localWs.close(); } catch { /* ignore */ }
      this.localWebSockets.delete(requestId);
    };

    localWs.onclose = () => {
      if (entry.openTimer) {
        clearTimeout(entry.openTimer);
        entry.openTimer = null;
      }
      if (!entry.serverNotified) {
        entry.serverNotified = true;
        this.notifyServerWSClose(requestId);
      }
      this.localWebSockets.delete(requestId);
    };

    this.localWebSockets.set(requestId, entry);
  }
  private handleWSData(requestId: string, data: string): void {
    const entry = this.localWebSockets.get(requestId);
    if (!entry) {
      console.error(`[tunnel-client] WS data dropped: no entry for requestId=${requestId}`);
      return;
    }
    if (entry.socket.readyState !== WebSocket.OPEN) {
      console.error(`[tunnel-client] WS data dropped: local WS not open for requestId=${requestId} readyState=${entry.socket.readyState}`);
      return;
    }
    entry.socket.send(Buffer.from(data, "base64"));
  }
  private handleWSClose(requestId: string): void {
    const entry = this.localWebSockets.get(requestId);
    if (entry) {
      console.log(`[tunnel-client] WS close: requestId=${requestId}`);
      clearTimeout(entry.openTimer);
      try { entry.socket.close(); } catch { /* ignore */ }
      this.localWebSockets.delete(requestId);
    } else {
      console.error(`[tunnel-client] WS close: no entry for requestId=${requestId}`);
    }
  }

  private startHeartbeatWatchdog(): void {
    this.stopHeartbeatWatchdog();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastServerMessageAt >= CONTROL_HEARTBEAT_TIMEOUT_MS) {
        this.options.onError?.(new Error("Tunnel heartbeat timeout"));
        this.ws?.close();
      }
    }, CONTROL_HEARTBEAT_CHECK_MS);
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.maxReconnectDelay,
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        if (this.shouldReconnect) {
          this.attemptReconnect();
        }
      });
    }, delay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeatWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Close all local WebSocket bridges
    for (const [_requestId, entry] of this.localWebSockets) {
      clearTimeout(entry.openTimer);
      try { entry.socket.close(); } catch { /* ignore */ }
    }
    this.localWebSockets.clear();

    // Abort all in-flight local requests
    for (const [_requestId, controller] of this.pendingRequestControllers) {
      controller.abort();
    }
    this.pendingRequestControllers.clear();

    this.ws?.close();
  }
}
