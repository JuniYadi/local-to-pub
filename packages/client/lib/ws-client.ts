// packages/client/lib/ws-client.ts
import { proxyRequest } from "./http-proxy";

export interface TunnelClientOptions {
  serverUrl: string;
  token: string;
  localHost: string;
  localPort: number;
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
    });

    this.ws?.send(JSON.stringify({
      type: "response",
      requestId,
      status: response.status,
      headers: response.headers,
      body: response.body,
    }));
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
  }
}
