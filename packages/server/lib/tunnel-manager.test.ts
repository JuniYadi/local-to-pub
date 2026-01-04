// packages/server/lib/tunnel-manager.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { ServerWebSocket } from "bun";
import { TunnelManager } from "./tunnel-manager";

// Mock WebSocket interface for tests
interface MockWebSocket {
  send: ReturnType<typeof mock>;
}

describe("TunnelManager", () => {
  let manager: TunnelManager;

  beforeEach(() => {
    manager = new TunnelManager();
  });

  test("registerConnection stores WebSocket by subdomain", () => {
    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);

    expect(manager.getConnection("abc123")).toBe(mockWs);
  });

  test("unregisterConnection removes WebSocket", () => {
    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);
    manager.unregisterConnection("abc123");

    expect(manager.getConnection("abc123")).toBeUndefined();
  });

  test("getConnection returns undefined for unknown subdomain", () => {
    expect(manager.getConnection("unknown")).toBeUndefined();
  });

  test("waitForResponse and resolvePendingRequest work together", async () => {
    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);

    const requestId = crypto.randomUUID();

    // Start waiting for response (don't await yet)
    const responsePromise = manager.waitForResponse(requestId, "abc123");

    // Now the request should be pending
    expect(manager.hasPendingRequest(requestId)).toBe(true);

    // Resolve the request
    manager.resolvePendingRequest(requestId, { status: 200, headers: {}, body: "" });

    // Request should no longer be pending
    expect(manager.hasPendingRequest(requestId)).toBe(false);

    // Promise should resolve with the response
    const response = await responsePromise;
    expect(response.status).toBe(200);
  });
});
