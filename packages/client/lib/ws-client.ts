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
  private pendingRequestControllers = new Map<string, AbortController>();
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private lastServerMessageAt = 0;
  constructor(options: TunnelClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let settled = false;

    this.ws = new WebSocket(this.options.serverUrl);

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
        this.handleWSOpen(msg.requestId as string, msg.path as string);
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

      // Abort all in-flight local requests
      for (const [_requestId, controller] of this.pendingRequestControllers) {
        controller.abort();
      }
      this.pendingRequestControllers.clear();

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
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string;

    const controlWs = this.ws;
    if (!controlWs || controlWs.readyState !== WebSocket.OPEN) {
      return;
    }

    this.options.onRequest?.(method, path);

    const abortController = new AbortController();
    this.pendingRequestControllers.set(requestId, abortController);

    try {
      const response = await proxyRequest({
        host: this.options.localHost,
        port: this.options.localPort,
        method,
        path,
        headers,
        body,
        hostHeader: this.options.hostHeader,
        signal: abortController.signal,
      });

      if (controlWs === this.ws && controlWs.readyState === WebSocket.OPEN) {
        controlWs.send(JSON.stringify({
          type: "response",
          requestId,
          status: response.status,
          headers: response.headers,
          body: response.body,
        }));
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

  private handleWSOpen(requestId: string, path: string): void {
    const url = `ws://${this.options.localHost}:${this.options.localPort}${path}`;
    const localWs = new WebSocket(url);

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

    localWs.onmessage = (event) => {
      const data = event.data;
      const base64Data = Buffer.from(typeof data === "string" ? data : data).toString("base64");

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
    if (entry && entry.socket.readyState === WebSocket.OPEN) {
      entry.socket.send(Buffer.from(data, "base64"));
    }
  }

  private handleWSClose(requestId: string): void {
    const entry = this.localWebSockets.get(requestId);
    if (entry) {
      clearTimeout(entry.openTimer);
      try { entry.socket.close(); } catch { /* ignore */ }
      this.localWebSockets.delete(requestId);
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
        // Reconnection will be attempted on close
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
