// packages/client/lib/ws-client.test.ts
import { test, expect, describe, afterEach, beforeEach, jest, mock } from "bun:test";
import { TunnelClient } from "./ws-client";

const OriginalWebSocket = globalThis.WebSocket;

interface MockWebSocketInstance {
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;
  options?: unknown;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send = mock((_data: string): void => {});
  close = mock((): void => {
    if (this.onclose) {
      this.onclose({});
    }
  });

  static instances: MockWebSocket[] = [];

  constructor(url: string, options?: unknown) {
    this.url = url;
    this.options = options;
    MockWebSocket.instances.push(this);
  }
}

describe("TunnelClient", () => {
  let client: TunnelClient;
  const defaultOptions = {
    serverUrl: "ws://localhost:3000/tunnel",
    token: "test-token",
    localHost: "localhost",
    localPort: 3001,
  };

  beforeEach(() => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof globalThis.WebSocket;
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    MockWebSocket.instances = [];
    client?.disconnect();
    jest.useRealTimers();
  });

  function setupConnectedClient(): MockWebSocketInstance {
    client = new TunnelClient(defaultOptions);
    client.connect();
    const ws = MockWebSocket.instances[0];

    expect(ws).toBeDefined();
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.({});
    ws.onmessage?.({ data: JSON.stringify({ type: "auth_ok", url: "https://abc.example.com" }) });

    return ws;
  }

  test("reconnects after control socket closes", async () => {
    jest.useFakeTimers();

    const ws = setupConnectedClient();
    const initialInstanceCount = MockWebSocket.instances.length;

    // Simulate close
    ws.onclose?.({});

    jest.advanceTimersByTime(1001);
    // Should have created a new WebSocket instance for reconnection
    expect(MockWebSocket.instances.length).toBeGreaterThan(initialInstanceCount);
  });

  test("reconnect retries after onerror without onclose", async () => {
    jest.useFakeTimers();

    const ws = setupConnectedClient();

    // Close to trigger first reconnect attempt
    ws.onclose?.({});

    // Advance past first reconnect delay (1000ms)
    jest.advanceTimersByTime(1001);
    const secondWs = MockWebSocket.instances[1];
    expect(secondWs).toBeDefined();

    // Trigger onerror on the second WS without onclose
    secondWs.onerror?.({});

    // The connect() promise rejection needs TWO microtasks to propagate
    // through the async function wrapping before .catch() fires.
    // await Promise.resolve() flushes one microtask at a time.
    await Promise.resolve();
    await Promise.resolve();

    // Now attemptReconnect() has set the next reconnect timer (2000ms)
    jest.advanceTimersByTime(2001);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(3);
  });

  test("closes local sockets when the control socket closes", () => {
    const ws = setupConnectedClient();

    // Send ws_open to create a local WebSocket bridge
    ws.onmessage?.({ data: JSON.stringify({ type: "ws_open", requestId: "req-1", path: "/ws" }) });

    // The local WebSocket should have been created as a new MockWebSocket instance
    const localSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(localSocket).toBeDefined();
    expect(localSocket.close).toBeDefined();

    // Close the control socket
    ws.onclose?.({});

    // The local socket should have been closed
    expect(localSocket.close).toHaveBeenCalled();
  });

  test("notifies the server when local WebSocket open times out", () => {
    jest.useFakeTimers();

    const ws = setupConnectedClient();
    ws.send.mock?.calls?.splice(0); // Clear previous send calls

    // Send ws_open — the local WebSocket timer starts
    ws.onmessage?.({ data: JSON.stringify({ type: "ws_open", requestId: "req-1", path: "/ws" }) });

    // Advance past the 10-second open timeout
    jest.advanceTimersByTime(10_001);

    // The control socket should have sent a ws_close message
    const sentCalls = ws.send.mock?.calls ?? [];
    const wsCloseCall = sentCalls.find((call: string[]) => {
      try {
        const parsed = JSON.parse(call[0]);
        return parsed.type === "ws_close" && parsed.requestId === "req-1";
      } catch {
        return false;
      }
    });
    expect(wsCloseCall).toBeDefined();
  });

  test("forwards WS upgrade headers to the local WebSocket", () => {
    jest.useFakeTimers();

    const onRequest = mock(() => {});
    client = new TunnelClient({ ...defaultOptions, onRequest });
    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.({});
    ws.onmessage?.({ data: JSON.stringify({ type: "auth_ok", url: "https://abc.example.com" }) });

    // Clear the send mock so we only check ws_open-related sends later
    ws.send.mock?.calls?.splice(0);
    const localInstancesBefore = MockWebSocket.instances.length;

    // Send ws_open with headers as the server would now send them
    ws.onmessage?.({ data: JSON.stringify({
      type: "ws_open",
      requestId: "req-headers",
      path: "/_next/webpack-hmr?page=/",
      headers: {
        host: "demo.tunnel.example.com",
        origin: "https://demo.tunnel.example.com",
        cookie: "sid=1",
        "sec-websocket-protocol": "webpack-hmr",
        "sec-websocket-key": "browser-key",
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https",
      },
    }) });

    const localSocket = MockWebSocket.instances[localInstancesBefore];
    expect(localSocket).toBeDefined();
    expect(localSocket.url).toBe("ws://localhost:3001/_next/webpack-hmr?page=/");
    expect(localSocket.options).toEqual({
      headers: {
        origin: "https://demo.tunnel.example.com",
        cookie: "sid=1",
        "sec-websocket-protocol": "webpack-hmr",
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https",
        host: "localhost:3001",
      },
    });
    expect(onRequest).toHaveBeenCalledWith("WS", "/_next/webpack-hmr?page=/");
  });

  test("aborts in-flight proxy requests when control socket closes", async () => {
    const originalFetch = globalThis.fetch;
    let capturedSignal: AbortSignal | undefined;

    try {
      // Mock fetch to hang until aborted
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          if (capturedSignal) {
            capturedSignal.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            }, { once: true });
          }
        });
      }) as typeof globalThis.fetch;

      const ws = setupConnectedClient();

      // Send a request message to start a proxy request
      ws.onmessage?.({ data: JSON.stringify({
        type: "request",
        requestId: "req-1",
        method: "GET",
        path: "/slow",
        headers: {},
        body: "",
      }) });

      // The pending request should be tracked and fetch should have been called
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      // Close the control socket
      ws.onclose?.({});

      // The local fetch should have been aborted
      expect(capturedSignal!.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});
