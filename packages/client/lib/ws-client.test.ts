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

  constructor(_url: string) {
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
});
