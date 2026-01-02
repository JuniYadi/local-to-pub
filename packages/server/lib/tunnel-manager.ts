// packages/server/lib/tunnel-manager.ts
import type { ServerWebSocket } from "bun";

export interface PendingRequest {
  subdomain: string;
  resolve: (response: HttpResponse) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string; // base64
}

export interface TunnelConnection {
  ws: ServerWebSocket<unknown>;
  tokenId: number;
  subdomain: string;
  connectedAt: number;
}

export class TunnelManager {
  private connections = new Map<string, ServerWebSocket<unknown>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  registerConnection(subdomain: string, ws: ServerWebSocket<unknown>): void {
    this.connections.set(subdomain, ws);
  }

  unregisterConnection(subdomain: string): void {
    this.connections.delete(subdomain);

    // Reject all pending requests for this subdomain
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.subdomain === subdomain) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Tunnel disconnected"));
        this.pendingRequests.delete(requestId);
      }
    }
  }

  getConnection(subdomain: string): ServerWebSocket<unknown> | undefined {
    return this.connections.get(subdomain);
  }

  hasConnection(subdomain: string): boolean {
    return this.connections.has(subdomain);
  }

  createPendingRequest(subdomain: string): string {
    const requestId = crypto.randomUUID();
    return requestId;
  }

  waitForResponse(requestId: string, subdomain: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(requestId, {
        subdomain,
        resolve,
        reject,
        timeout,
      });
    });
  }

  hasPendingRequest(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  resolvePendingRequest(requestId: string, response: HttpResponse): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    pending.resolve(response);
    this.pendingRequests.delete(requestId);
    return true;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
