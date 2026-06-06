// packages/client/lib/http-proxy.test.ts
import { test, expect, describe } from "bun:test";
import { proxyRequest } from "./http-proxy";

describe("HTTP Proxy", () => {
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

  test("preserves path prefix when redirect strips it (i18n default locale)", async () => {
    // Next.js i18n redirect strips /id prefix from /id/login/start -> /login/start
    const mockResponse = new Response(null, {
      status: 307,
      headers: { "Location": "/login/start?next=%2Fid&provider=github" },
    });
    
    // @ts-expect-error - Mocking global fetch
    global.fetch = async () => mockResponse;

    const result = await proxyRequest({
      host: "localhost",
      port: 3000,
      method: "GET",
      path: "/id/login/start?next=%2Fid&provider=github",
      headers: {
        "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
        "x-forwarded-proto": "https"
      },
      body: "",
    });

    expect(result.status).toBe(307);
    // Should preserve /id prefix: /id/login/start, not /login/start
    expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
  });
});
