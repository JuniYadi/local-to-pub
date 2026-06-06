// packages/client/lib/http-proxy.test.ts
import { test, expect, describe, spyOn } from "bun:test";
import { proxyRequest } from "./http-proxy";

describe("HTTP Proxy", () => {
  test("proxyRequest forwards GET request", async () => {
    const mockResponse = new Response("hello world", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    
    // @ts-ignore
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
    
    // @ts-ignore
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
    
    // @ts-ignore
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
});
