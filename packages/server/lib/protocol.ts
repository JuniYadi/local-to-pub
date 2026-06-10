// packages/server/lib/protocol.ts

// Client → Server messages
export interface AuthMessage {
  type: "auth";
  token: string;
  requestedSubdomain?: string;
  force?: boolean;
}

export interface ResponseMessage {
  type: "response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string; // base64 encoded
}

export interface WSReadyMessage {
  type: "ws_ready";
  requestId: string;
}

export interface PongMessage {
  type: "pong";
}

export type ClientMessage = AuthMessage | ResponseMessage | WSReadyMessage | WSDataMessage | WSCloseMessage | PongMessage;

// Server → Client messages
export interface AuthOkMessage {
  type: "auth_ok";
  subdomain: string;
  url: string;
}

export interface AuthErrorMessage {
  type: "auth_error";
  message: string;
}

export interface RequestMessage {
  type: "request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64 encoded
}

export interface WSOpenMessage {
  type: "ws_open";
  requestId: string;
  path: string;
  headers: Record<string, string>;
}

export interface WSDataMessage {
  type: "ws_data";
  requestId: string;
  data: string; // base64 encoded
}

export interface WSCloseMessage {
  type: "ws_close";
  requestId: string;
}

export interface PingMessage {
  type: "ping";
}

export type ServerMessage = AuthOkMessage | AuthErrorMessage | RequestMessage | WSOpenMessage | WSDataMessage | WSCloseMessage | PingMessage;

// Helper functions
export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data);
    if (msg.type === "auth" && typeof msg.token === "string") {
      // requestedSubdomain is optional
      if (msg.requestedSubdomain !== undefined && typeof msg.requestedSubdomain !== "string") {
        return null;
      }
      return msg as AuthMessage;
    }
    if (msg.type === "response" && typeof msg.requestId === "string") {
      return msg as ResponseMessage;
    }
    if (msg.type === "ws_ready" && typeof msg.requestId === "string") {
      return msg as WSReadyMessage;
    }
    if (msg.type === "ws_data" && typeof msg.requestId === "string" && typeof msg.data === "string") {
      return msg as WSDataMessage;
    }
    if (msg.type === "ws_close" && typeof msg.requestId === "string") {
      return msg as WSCloseMessage;
    }
    if (msg.type === "pong") {
      return msg as PongMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
