// packages/client/lib/ws-client.ts
import { proxyRequest } from "./http-proxy";

export interface TunnelClientOptions {
  serverUrl: string;
  token: string;
  localHost: string;
  localPort: number;
  hostHeader?: string;
  requestedSubdomain?: string;
  onConnected?: (url: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRequest?: (method: string, path: string) => void;
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private options: TunnelClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private localWebSockets = new Map<string, WebSocket>();

  constructor(options: TunnelClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.serverUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        // Send auth message
        const authMessage: { type: string; token: string; requestedSubdomain?: string } = {
          type: "auth",
          token: this.options.token,
        };
        if (this.options.requestedSubdomain) {
          authMessage.requestedSubdomain = this.options.requestedSubdomain;
        }
        this.ws?.send(JSON.stringify(authMessage));
      };

      this.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === "auth_ok") {
          const url = msg.url as string;
          this.options.onConnected?.(url);
          resolve();
        }

        if (msg.type === "auth_error") {
          const error = new Error(msg.message as string);
          this.options.onError?.(error);
          this.shouldReconnect = false;
          reject(error);
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
      };

      this.ws.onclose = () => {
        this.options.onDisconnected?.();
        if (this.shouldReconnect) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = () => {
        this.options.onError?.(new Error("WebSocket error"));
      };
    });
  }

  private async handleRequest(msg: ServerMessage): Promise<void> {
    const requestId = msg.requestId as string;
    const method = msg.method as string;
    const path = msg.path as string;
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string;

    this.options.onRequest?.(method, path);

    const response = await proxyRequest({
      host: this.options.localHost,
      port: this.options.localPort,
      method,
      path,
      headers,
      body,
      hostHeader: this.options.hostHeader,
    });

    this.ws?.send(JSON.stringify({
      type: "response",
      requestId,
      status: response.status,
      headers: response.headers,
      body: response.body,
    }));
  }

  private handleWSOpen(requestId: string, path: string): void {
    const url = `ws://${this.options.localHost}:${this.options.localPort}${path}`;
    const localWs = new WebSocket(url);

    localWs.onopen = () => {
      this.ws?.send(JSON.stringify({
        type: "ws_ready",
        requestId,
      }));
    };

    localWs.onmessage = (event) => {
      const data = event.data;
      let base64Data: string;

      if (typeof data === "string") {
        base64Data = Buffer.from(data).toString("base64");
      } else {
        base64Data = Buffer.from(data).toString("base64");
      }

      this.ws?.send(JSON.stringify({
        type: "ws_data",
        requestId,
        data: base64Data,
      }));
    };

    localWs.onclose = () => {
      this.ws?.send(JSON.stringify({
        type: "ws_close",
        requestId,
      }));
      this.localWebSockets.delete(requestId);
    };

    localWs.onerror = () => {
      this.handleWSClose(requestId);
    };

    this.localWebSockets.set(requestId, localWs);
  }

  private handleWSData(requestId: string, data: string): void {
    const localWs = this.localWebSockets.get(requestId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(Buffer.from(data, "base64"));
    }
  }

  private handleWSClose(requestId: string): void {
    const localWs = this.localWebSockets.get(requestId);
    if (localWs) {
      localWs.close();
      this.localWebSockets.delete(requestId);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.options.onError?.(new Error("Max reconnection attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnection will be attempted on close
      });
    }, delay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
    for (const localWs of this.localWebSockets.values()) {
      localWs.close();
    }
    this.localWebSockets.clear();
  }
}
