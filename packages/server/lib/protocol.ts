// packages/server/lib/protocol.ts

// Client → Server messages
export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface ResponseMessage {
  type: "response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string; // base64 encoded
}

export type ClientMessage = AuthMessage | ResponseMessage;

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

export type ServerMessage = AuthOkMessage | AuthErrorMessage | RequestMessage;

// Helper functions
export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data);
    if (msg.type === "auth" && typeof msg.token === "string") {
      return msg as AuthMessage;
    }
    if (msg.type === "response" && typeof msg.requestId === "string") {
      return msg as ResponseMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
