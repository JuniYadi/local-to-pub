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

  test("buffered messages are held until markBrowserConnectionReady", () => {
    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerBrowserConnection("ws-1", "abc123", mockWs);

    const r1 = manager.queueBrowserMessage("ws-1", "msg1");
    expect(r1).toEqual({ subdomain: "abc123", ready: false });

    const r2 = manager.queueBrowserMessage("ws-1", "msg2");
    expect(r2).toEqual({ subdomain: "abc123", ready: false });

    const ready = manager.markBrowserConnectionReady("ws-1");
    expect(ready).toEqual({ subdomain: "abc123", messages: ["msg1", "msg2"] });
  });

  test("queueBrowserMessage returns ready: true when connection is ready", () => {
    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerBrowserConnection("ws-1", "abc123", mockWs);
    manager.markBrowserConnectionReady("ws-1");

    const result = manager.queueBrowserMessage("ws-1", "msg");
    expect(result).toEqual({ subdomain: "abc123", ready: true });
  });

  test("queueBrowserMessage closes connection when buffer exceeds 100 messages", () => {
    const mockWs = { send: mock(() => {}), close: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerBrowserConnection("ws-1", "abc123", mockWs);

    // Fill buffer to 100
    for (let i = 0; i < 100; i++) {
      const result = manager.queueBrowserMessage("ws-1", `msg${i}`);
      expect(result).toEqual({ subdomain: "abc123", ready: false });
    }
    // 101st triggers close
    const result = manager.queueBrowserMessage("ws-1", "overflow");
    expect(result).toBeNull();
  });

  test("queueBrowserMessage returns null for nonexistent connection", () => {
    const result = manager.queueBrowserMessage("nonexistent", "msg");
    expect(result).toBeNull();
  });

  test("markBrowserConnectionReady returns null for nonexistent connection", () => {
    const result = manager.markBrowserConnectionReady("nonexistent");
    expect(result).toBeNull();
  });

  test("REQUEST_TIMEOUT_ERROR constant is exported", () => {
    const { REQUEST_TIMEOUT_ERROR } = require("./tunnel-manager");
    expect(REQUEST_TIMEOUT_ERROR).toBe("Request timeout");
  });
});
