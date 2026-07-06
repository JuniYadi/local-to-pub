// packages/client/lib/http-proxy.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { proxyRequest } from "./http-proxy";

const originalFetch = global.fetch;

describe("HTTP Proxy", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });
  test("proxyRequest forwards GET request", async () => {
    const mockResponse = new Response("hello world", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await proxyRequest({
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "myapp.tunnel.me",
        "x-forwarded-proto": "https"
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "myapp.tunnel.me",
        "x-forwarded-proto": "https"
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/login",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https"
      },
      body: "",
    });

    expect(result.status).toBe(307);
    // Pass through path as-is from local server response
    expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
  });

  test("preserves locale prefix when local redirect strips it", async () => {
    const mockResponse = new Response(null, {
      status: 307,
      headers: { "Location": "/login/start?next=%2Fid&provider=github" },
    });

    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await proxyRequest({
      host: "localhost",
      port: 3300,
      method: "GET",
      path: "/id/login/start?next=%2Fid&provider=github",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https"
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3300,
      method: "GET",
      path: "/id/login/start?next=%2Fid&provider=github",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https"
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/id",
      headers: {
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https"
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

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/id",
      headers: {
        "x-forwarded-host": "demo.tunnel.example.com",
        "x-forwarded-proto": "https"
      },
      body: "",
    });

    expect(result.status).toBe(308);
    expect(result.headers["location"]).toBe("https://demo.tunnel.example.com/id/");
  });

  test("proxyRequest returns 504 when the local server exceeds the timeout", async () => {
    // @ts-expect-error - Mocking global fetch
    global.fetch = async (_url, init) => {
      // Return a promise that will be aborted
      return new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const result = await proxyRequest({
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

    const result = await proxyRequest({
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
});
