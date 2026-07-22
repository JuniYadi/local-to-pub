// packages/client/lib/http-proxy.test.ts
import { test, expect, describe, afterEach, jest } from "bun:test";
import { proxyRequest, LOCAL_REQUEST_TIMEOUT_MS, parseTimeoutMs } from "./http-proxy";

const originalFetch = global.fetch;

async function collectProxyRequest(req: Parameters<typeof proxyRequest>[0]) {
  const parts: any[] = [];
  for await (const part of proxyRequest(req)) {
    parts.push(part);
  }
  const head = parts.find((p): p is { type: "head"; status: number; headers: Record<string, string | string[]> } => p.type === "head");
  const dataParts = parts.filter((p): p is { type: "data"; data: string } => p.type === "data");
  const body = dataParts.map(p => p.data).join("");
  return {
    status: head?.status ?? 0,
    headers: head?.headers ?? {},
    body,
    parts,
  };
}

describe("HTTP Proxy", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("LOCAL_REQUEST_TIMEOUT_MS is 20 minutes for slow dev compilation", () => {
    expect(LOCAL_REQUEST_TIMEOUT_MS).toBe(1_200_000);
  });

  test("parseTimeoutMs uses fallback for undefined", () => {
    expect(parseTimeoutMs(undefined, 300_000)).toBe(300_000);
  });

  test("parseTimeoutMs uses fallback for NaN", () => {
    expect(parseTimeoutMs("not-a-number", 300_000)).toBe(300_000);
  });

  test("parseTimeoutMs uses fallback for values below 1000", () => {
    expect(parseTimeoutMs("500", 300_000)).toBe(300_000);
  });

  test("parseTimeoutMs parses valid env value", () => {
    expect(parseTimeoutMs("600000", 300_000)).toBe(600_000);
  });

  test("proxyRequest forwards GET request", async () => {
    const mockResponse = new Response("hello world", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/",
      headers: {},
      body: "",
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe(Buffer.from("hello world").toString("base64"));
  });

  test("rewrites Location header for local redirects", async () => {
    const mockResponse = new Response(null, {
      status: 302,
      headers: { "Location": "http://localhost:3000/auth/callback" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "myapp.tunnel.me",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(302);
    expect(result.headers["location"]).toBe("https://myapp.tunnel.me/auth/callback");
  });

  test("does not rewrite external Location headers", async () => {
    const mockResponse = new Response(null, {
      status: 302,
      headers: { "Location": "https://github.com/login" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "myapp.tunnel.me",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(302);
    expect(result.headers["location"]).toBe("https://github.com/login");
  });

  test("passes through redirect path as-is from local server", async () => {
    // Local server returns redirect, proxy should pass path as-is
    const mockResponse = new Response(null, {
      status: 307,
      headers: { "Location": "/id/login/start?next=%2Fid&provider=github" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(307);
    expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
  });

  test("preserves locale prefix when local redirect strips it", async () => {
    const mockResponse = new Response(null, {
      status: 307,
      headers: { "Location": "/login/start?next=%2Fid&provider=github" },
    });

    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3300,
      method: "GET",
      path: "/id/login/start?next=%2Fid&provider=github",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(307);
    expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
  });

  test("preserves locale prefix when absolute local redirect strips it", async () => {
    const mockResponse = new Response(null, {
      status: 307,
      headers: { "Location": "http://localhost:3300/login/start?next=%2Fid&provider=github" },
    });

    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3300,
      method: "GET",
      path: "/id/login/start?next=%2Fid&provider=github",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(307);
    expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
  });

  test("rewrites trailing-slash redirects without auto-following them", async () => {
    let calls = 0;

    // @ts-expect-error - Mocking global fetch
    global.fetch = async (_input, init) => {
      calls++;
      expect(init?.redirect).toBe("manual");

      return new Response(null, {
        status: 307,
        headers: { "Location": "http://localhost:3000/id/" },
      });
    };

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/id",
      headers: {
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(calls).toBe(1);
    expect(result.status).toBe(307);
    expect(result.headers["location"]).toBe("https://demo.tunnel.example.com/id/");
  });

  test("rewrites relative trailing-slash redirects to the public URL", async () => {
    // @ts-expect-error - Mocking global fetch
    global.fetch = async (_input, init) => {
      expect(init?.redirect).toBe("manual");

      return new Response(null, {
        status: 308,
        headers: { "Location": "/id/" },
      });
    };

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/id",
      headers: {
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https",
      },
      body: "",
    });

    expect(result.status).toBe(308);
    expect(result.headers["location"]).toBe("https://demo.tunnel.example.com/id/");
  });

  test("proxyRequest returns 504 when the local server exceeds the timeout", async () => {
    // @ts-expect-error - Mocking global fetch
    global.fetch = async (_url, init) => {
      return new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/slow",
      headers: {},
      body: "",
      timeoutMs: 1,
    });

    expect(result.status).toBe(504);
    expect(Buffer.from(result.body, "base64").toString()).toBe("Local server timed out");
  });

  test("proxyRequest returns 502 for local connection failures", async () => {
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const result = await collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/test",
      headers: {},
      body: "",
    });

    expect(result.status).toBe(502);
    expect(Buffer.from(result.body, "base64").toString()).toBe("Failed to connect to local server");
  });

  test("proxyRequest keeps slow dev responses open past the old timeout", async () => {
    jest.useFakeTimers();

    let resolveFetch: (r: Response) => void;
    let capturedSignal: AbortSignal | undefined;

    // @ts-expect-error - Mocking global fetch
    global.fetch = async (_url, init) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const resultPromise = collectProxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/slow-dev",
      headers: {},
      body: "",
    });

    jest.advanceTimersByTime(16 * 60_000 + 10_000);

    expect(capturedSignal?.aborted).toBe(false);

    resolveFetch!(new Response("compiled", { status: 200 }));

    const result = await resultPromise;
    expect(result.status).toBe(200);
    expect(result.body).toBe(Buffer.from("compiled").toString("base64"));
  });

  test("streams a chunked response parts correctly", async () => {
    const chunk1 = new TextEncoder().encode("chunk0\n");
    const chunk2 = new TextEncoder().encode("chunk1\n");
    const chunk3 = new TextEncoder().encode("chunk2\n");

    let pullCount = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (pullCount >= 3) { controller.close(); return; }
        const chunks = [chunk1, chunk2, chunk3];
        controller.enqueue(chunks[pullCount]);
        pullCount++;
      },
    });

    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/x-component" },
    });

    const parts: any[] = [];
    for await (const part of proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/rsc",
      headers: {},
      body: "",
    })) {
      parts.push(part);
    }

    expect(parts.length).toBe(5); // head + 3 data + end
    expect(parts[0].type).toBe("head");
    expect(parts[0].status).toBe(200);
    expect(parts[0].headers["content-type"]).toBe("text/x-component");
    expect(parts[1].type).toBe("data");
    expect(Buffer.from(parts[1].data, "base64").toString()).toBe("chunk0\n");
    expect(parts[2].type).toBe("data");
    expect(Buffer.from(parts[2].data, "base64").toString()).toBe("chunk1\n");
    expect(parts[3].type).toBe("data");
    expect(Buffer.from(parts[3].data, "base64").toString()).toBe("chunk2\n");
    expect(parts[4].type).toBe("end");
  });

  test("preserves multi-value Set-Cookie headers", async () => {
    const response = new Response(null, { status: 200, headers: { "Content-Type": "text/plain" } });
    response.headers.append("Set-Cookie", "a=1");
    response.headers.append("Set-Cookie", "b=2");

    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => response;

    const parts: any[] = [];
    for await (const part of proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/multi-cookie",
      headers: {},
      body: "",
    })) {
      parts.push(part);
    }

    const head = parts.find((p: any) => p.type === "head");
    expect(head).toBeDefined();
    const setCookie = head!.headers["set-cookie"];
    expect(setCookie).toEqual(["a=1", "b=2"]);
  });
});
