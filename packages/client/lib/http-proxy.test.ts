// packages/client/lib/http-proxy.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { proxyRequest } from "./http-proxy";

describe("HTTP Proxy", () => {
  let testServer: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    testServer = Bun.serve({
      port: 9999,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/echo") {
          return new Response(JSON.stringify({
            method: req.method,
            path: url.pathname,
            headers: Object.fromEntries(req.headers.entries()),
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/status/201") {
          return new Response("Created", { status: 201 });
        }

        return new Response("Not Found", { status: 404 });
      },
    });
  });

  afterAll(() => {
    testServer.stop();
  });

  test("proxyRequest forwards GET request", async () => {
    const response = await proxyRequest({
      host: "localhost",
      port: 9999,
      method: "GET",
      path: "/echo",
      headers: { "X-Test": "value" },
      body: "",
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(Buffer.from(response.body, "base64").toString());
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/echo");
  });

  test("proxyRequest returns correct status code", async () => {
    const response = await proxyRequest({
      host: "localhost",
      port: 9999,
      method: "GET",
      path: "/status/201",
      headers: {},
      body: "",
    });

    expect(response.status).toBe(201);
  });

  test("proxyRequest handles 404", async () => {
    const response = await proxyRequest({
      host: "localhost",
      port: 9999,
      method: "GET",
      path: "/not-found",
      headers: {},
      body: "",
    });

    expect(response.status).toBe(404);
  });
});
