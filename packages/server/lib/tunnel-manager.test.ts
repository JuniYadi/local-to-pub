// packages/server/lib/tunnel-manager.test.ts
import { describe, test, expect, beforeEach, afterEach, mock, jest } from "bun:test";
import type { ServerWebSocket } from "bun";
import { TunnelManager, REQUEST_TIMEOUT_ERROR, TUNNEL_REQUEST_TIMEOUT_MS, parseTimeoutMs } from "./tunnel-manager";

// Mock WebSocket interface for tests
interface MockWebSocket {
  send: ReturnType<typeof mock>;
  readyState?: number;
  data?: { lastActivity?: number; connectionId?: number };
  close?: ReturnType<typeof mock>;
}

describe("TunnelManager", () => {
  let manager: TunnelManager;

  beforeEach(() => {
    manager = new TunnelManager();
  });

  afterEach(() => {
    jest.useRealTimers();
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
  test("isConnectionStale returns true for missing subdomain", () => {
    expect(manager.isConnectionStale("unknown", 45_000)).toBe(true);
  });

  test("isConnectionStale returns false for open connection with recent activity", () => {
    const mockWs = { send: mock(() => {}), readyState: 1, data: { lastActivity: Date.now() } } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);
    expect(manager.isConnectionStale("abc123", 45_000)).toBe(false);
  });

  test("isConnectionStale returns true for closed connection", () => {
    const mockWs = { send: mock(() => {}), readyState: 3, data: { lastActivity: Date.now() } } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);
    expect(manager.isConnectionStale("abc123", 45_000)).toBe(true);
  });

  test("isConnectionStale returns true when lastActivity exceeds maxIdleMs", () => {
    const mockWs = { send: mock(() => {}), readyState: 1, data: { lastActivity: Date.now() - 45_001 } } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);
    expect(manager.isConnectionStale("abc123", 45_000)).toBe(true);
  });

  test("closeConnection cleans up control socket, browser sockets, and pending requests", async () => {
    const closeControl = mock(() => {});
    const closeBrowser = mock(() => {});
    const controlWs = { send: mock(() => {}), close: closeControl } as ServerWebSocket<MockWebSocket>;
    const browserWs = { send: mock(() => {}), close: closeBrowser } as ServerWebSocket<MockWebSocket>;

    manager.registerConnection("abc123", controlWs);
    manager.registerBrowserConnection("ws-1", "abc123", browserWs);

    const requestId = crypto.randomUUID();
    const responsePromise = manager.waitForResponse(requestId, "abc123");
    expect(manager.hasPendingRequest(requestId)).toBe(true);

    const result = manager.closeConnection("abc123");
    expect(result).toBe(true);
    expect(manager.getConnection("abc123")).toBeUndefined();
    expect(closeControl).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
    expect(manager.hasPendingRequest(requestId)).toBe(false);
    await expect(responsePromise).rejects.toThrow("Tunnel disconnected");
  });

  test("REQUEST_TIMEOUT_ERROR constant is exported", () => {
    expect(REQUEST_TIMEOUT_ERROR).toBe("Request timeout");
  });
  test("TUNNEL_REQUEST_TIMEOUT_MS is 305 seconds (5s longer than client)", () => {
    expect(TUNNEL_REQUEST_TIMEOUT_MS).toBe(305_000);
  });

  test("parseTimeoutMs uses fallback for undefined", () => {
    expect(parseTimeoutMs(undefined, 305_000)).toBe(305_000);
  });

  test("parseTimeoutMs uses fallback for NaN", () => {
    expect(parseTimeoutMs("not-a-number", 305_000)).toBe(305_000);
  });

  test("parseTimeoutMs uses fallback for values below 1000", () => {
    expect(parseTimeoutMs("500", 305_000)).toBe(305_000);
  });

  test("parseTimeoutMs parses valid env value", () => {
    expect(parseTimeoutMs("600000", 305_000)).toBe(600_000);
  });

  test("TUNNEL_REQUEST_TIMEOUT_MS is exported and has default value", () => {
    expect(TUNNEL_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
  });

  test("rejectPendingRequest rejects the pending promise and cleans up", async () => {
    jest.useFakeTimers();

    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("test-sub", mockWs);

    const requestId = crypto.randomUUID();
    const responsePromise = manager.waitForResponse(requestId, "test-sub");

    expect(manager.hasPendingRequest(requestId)).toBe(true);

    const rejectError = new Error("Rejected by test");
    const result = manager.rejectPendingRequest(requestId, rejectError);
    expect(result).toBe(true);
    expect(manager.hasPendingRequest(requestId)).toBe(false);

    await expect(responsePromise).rejects.toThrow("Rejected by test");

    jest.useRealTimers();
  });

  test("waitForResponse stays pending through the client dev timeout window", async () => {
    jest.useFakeTimers();

    const mockWs = { send: mock(() => {}) } as ServerWebSocket<MockWebSocket>;
    manager.registerConnection("abc123", mockWs);

    const requestId = crypto.randomUUID();
    const responsePromise = manager.waitForResponse(requestId, "abc123");
    // Advance past the 300s client default
    jest.advanceTimersByTime(300_001);

    // Request should still be pending (server waits 305s)
    expect(manager.hasPendingRequest(requestId)).toBe(true);

    // Resolve the request
    manager.resolvePendingRequest(requestId, { status: 200, headers: {}, body: "" });

    // Should no longer be pending
    expect(manager.hasPendingRequest(requestId)).toBe(false);

    // Promise should resolve with 200
    const response = await responsePromise;
    expect(response.status).toBe(200);
  });
});
