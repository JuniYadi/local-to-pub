// packages/server/lib/tunnel-manager.ts
import type { ServerWebSocket } from "bun";

export function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1_000) return fallback;
  return parsed;
}

export const REQUEST_TIMEOUT_ERROR = "Request timeout";
export const TUNNEL_REQUEST_TIMEOUT_MS = parseTimeoutMs(Bun.env.TUNNEL_REQUEST_TIMEOUT_MS, 305_000);


export interface PendingRequest {
  subdomain: string;
  resolve: (response: HttpResponse) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string; // base64
  stream?: ReadableStream;
}

export interface TunnelConnection {
  ws: ServerWebSocket<unknown>;
  tokenId: number;
  subdomain: string;
  connectedAt: number;
}

export interface BrowserConnection {
  ws: ServerWebSocket<unknown>;
  subdomain: string;
  ready: boolean;
  pendingMessages: string[];
}

export class TunnelManager {
  private connections = new Map<string, ServerWebSocket<unknown>>();
  private browserConnections = new Map<string, BrowserConnection>();
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly REQUEST_TIMEOUT = TUNNEL_REQUEST_TIMEOUT_MS;
  private readonly MAX_BUFFERED_WS_MESSAGES = 100;

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

    // Close all browser connections for this subdomain
    for (const [wsRequestId, conn] of this.browserConnections) {
      if (conn.subdomain === subdomain) {
        conn.ws.close();
        this.browserConnections.delete(wsRequestId);
      }
    }
  }

  registerBrowserConnection(wsRequestId: string, subdomain: string, ws: ServerWebSocket<unknown>): void {
    this.browserConnections.set(wsRequestId, { ws, subdomain, ready: false, pendingMessages: [] });
  }

  unregisterBrowserConnection(wsRequestId: string): void {
    this.browserConnections.delete(wsRequestId);
  }

  getBrowserConnection(wsRequestId: string): ServerWebSocket<unknown> | undefined {
    return this.browserConnections.get(wsRequestId)?.ws;
  }

  getConnection(subdomain: string): ServerWebSocket<unknown> | undefined {
    return this.connections.get(subdomain);
  }

  hasConnection(subdomain: string): boolean {
    return this.connections.has(subdomain);
  }
  isConnectionStale(subdomain: string, maxIdleMs: number): boolean {
    const ws = this.connections.get(subdomain);
    if (!ws) return true;
    if (ws.readyState !== WebSocket.OPEN) return true;
    const data = ws.data as { lastActivity?: number } | undefined;
    if (!data?.lastActivity) return true;
    return Date.now() - data.lastActivity >= maxIdleMs;
  }


  createPendingRequest(_subdomain: string): string {
    const requestId = crypto.randomUUID();
    return requestId;
  }

  waitForResponse(requestId: string, subdomain: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(REQUEST_TIMEOUT_ERROR));
      }, TUNNEL_REQUEST_TIMEOUT_MS);

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
  rejectPendingRequest(requestId: string, error: Error): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    pending.reject(error);
    this.pendingRequests.delete(requestId);
    return true;
  }

  /**
   * Queue a browser WebSocket message for a connection that may not be ready yet.
   * Returns null if the browser connection does not exist.
   * Returns { subdomain, ready: true } if the connection is ready (caller should forward immediately).
   * Returns { subdomain, ready: false } if the message was buffered.
   */
  queueBrowserMessage(wsRequestId: string, data: string): { subdomain: string; ready: boolean } | null {
    const conn = this.browserConnections.get(wsRequestId);
    if (!conn) return null;

    if (conn.ready) {
      return { subdomain: conn.subdomain, ready: true };
    }

    if (conn.pendingMessages.length >= this.MAX_BUFFERED_WS_MESSAGES) {
      conn.ws.close();
      this.browserConnections.delete(wsRequestId);
      return null;
    }

    conn.pendingMessages.push(data);
    return { subdomain: conn.subdomain, ready: false };
  }

  /**
   * Mark a browser connection as ready and return any buffered messages.
   * Returns null if the browser connection does not exist.
   */
  markBrowserConnectionReady(wsRequestId: string): { subdomain: string; messages: string[] } | null {
    const conn = this.browserConnections.get(wsRequestId);
    if (!conn) return null;

    conn.ready = true;
    const messages = conn.pendingMessages;
    conn.pendingMessages = [];
    return { subdomain: conn.subdomain, messages };
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  getActiveSubdomains(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Force-close a connection and remove it from all internal maps.
   * Returns true if a connection was found and closed.
   */
  closeConnection(subdomain: string): boolean {
    const ws = this.connections.get(subdomain);
    if (!ws) return false;

    // Close all associated browser connections
    for (const [wsRequestId, conn] of this.browserConnections) {
      if (conn.subdomain === subdomain) {
        conn.ws.close();
        this.browserConnections.delete(wsRequestId);
      }
    }

    // Reject all pending requests for this subdomain
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.subdomain === subdomain) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Tunnel disconnected"));
        this.pendingRequests.delete(requestId);
      }
    }

    try { ws.close(); } catch { /* ignore */ }
    this.connections.delete(subdomain);
    return true;
  }
}
