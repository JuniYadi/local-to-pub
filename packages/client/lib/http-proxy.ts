// packages/client/lib/http-proxy.ts

export function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1_000) return fallback;
  return parsed;
}

const SLOW_DEV_RESPONSE_TIMEOUT_MS = 20 * 60_000;
export const LOCAL_REQUEST_TIMEOUT_MS = parseTimeoutMs(process.env.TUNNEL_LOCAL_REQUEST_TIMEOUT_MS, SLOW_DEV_RESPONSE_TIMEOUT_MS);

export interface ProxyRequest {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  body: string; // base64
  hostHeader?: string;
  timeoutMs?: number;
  signal?: AbortSignal; // external abort signal
}

export interface ProxyHead {
  type: "head";
  status: number;
  headers: Record<string, string | string[]>;
}

export interface ProxyData {
  type: "data";
  data: string; // base64
}

export interface ProxyEnd {
  type: "end";
}

export type ProxyPart = ProxyHead | ProxyData | ProxyEnd;

function rewriteRedirectLocation(location: string, req: ProxyRequest): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedProto = (req.headers["x-forwarded-proto"] as string) || "http";

  if (!forwardedHost) {
    return location;
  }

  const locUrl = new URL(location, `http://${req.host}:${req.port}`);
  if (locUrl.host !== `${req.host}:${req.port}` && locUrl.host !== req.host) {
    return location;
  }

  let redirectPath = locUrl.pathname + locUrl.search;

  if (req.path) {
    const redirectPathname = locUrl.pathname;
    const originalPathname = req.path.split("?")[0] as string;
    if (originalPathname.endsWith(redirectPathname) && redirectPathname !== originalPathname) {
      const prefix = originalPathname.slice(0, originalPathname.length - redirectPathname.length);
      if (prefix.startsWith("/")) {
        redirectPath = prefix + redirectPath;
      }
    }
  }

  return new URL(redirectPath, `${forwardedProto}://${forwardedHost}`).toString();
}

const skipRequestHeaders = new Set([
  "host", "connection", "keep-alive", "transfer-encoding",
  "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization",
]);

const skipResponseHeaders = new Set([
  "connection", "keep-alive", "transfer-encoding",
  "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization",
  "content-encoding", "content-length"
]);

export async function* proxyRequest(req: ProxyRequest): AsyncGenerator<ProxyPart> {
  const url = `http://${req.host}:${req.port}${req.path}`;

  // Build request headers — append arrays for multi-value headers
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipRequestHeaders.has(key.toLowerCase())) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  // Set Host header if overridden
  if (req.hostHeader) {
    headers.set("host", req.hostHeader);
  } else {
    headers.set("host", `${req.host}:${req.port}`);
  }

  const controller = new AbortController();
  if (req.signal) {
    req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? LOCAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.body ? Buffer.from(req.body, "base64") : undefined,
      redirect: "manual",
      signal: controller.signal,
    });

    // Yield head part with response headers
    const responseHeaders: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      if (!skipResponseHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    // Preserve multi-value Set-Cookie
    const setCookie = response.headers.getSetCookie();
    if (setCookie.length > 0) {
      responseHeaders["set-cookie"] = setCookie.length === 1 ? setCookie[0] as string : setCookie;
    }

    if (responseHeaders["location"]) {
      try {
        const loc = (responseHeaders["location"] as string);
        responseHeaders["location"] = rewriteRedirectLocation(loc, req);
      } catch {
        // Ignore invalid URLs in Location header
      }
    }

    yield { type: "head" as const, status: response.status, headers: responseHeaders };

    // Stream body chunks in a nested try so streaming errors don't yield a second head
    try {
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          let chunkTimer: Timer | undefined;
          let chunkDone = false;
          let chunkValue: Uint8Array | undefined;
          try {
            const result = await Promise.race([
              reader.read(),
              new Promise<{ done: true; value: undefined }>((_, reject) => {
                chunkTimer = setTimeout(
                  () => reject(new Error("Chunk timeout")),
                  req.timeoutMs ?? LOCAL_REQUEST_TIMEOUT_MS,
                );
              }),
            ]);
            chunkDone = result.done;
            chunkValue = result.value;
          } finally {
            clearTimeout(chunkTimer);
          }
          if (chunkDone) break;
          yield { type: "data" as const, data: Buffer.from(chunkValue!).toString("base64") };
        }
      }
      yield { type: "end" as const };
    } catch (e) {
      // Stream error or chunk timeout: head already sent, just end the stream
      const msg = e instanceof Error && e.message === "Chunk timeout"
        ? "Chunk read timed out"
        : "Stream error";
      yield { type: "data" as const, data: Buffer.from(msg).toString("base64") };
      yield { type: "end" as const };
    }
  } catch (error) {
    // Fetch never succeeded — head not sent yet
    if (error instanceof Error && error.name === "AbortError") {
      yield { type: "head" as const, status: 504, headers: { "Content-Type": "text/plain" } };
      yield { type: "data" as const, data: Buffer.from("Local server timed out").toString("base64") };
    } else {
      yield { type: "head" as const, status: 502, headers: { "Content-Type": "text/plain" } };
      yield { type: "data" as const, data: Buffer.from("Failed to connect to local server").toString("base64") };
    }
    yield { type: "end" as const };
  } finally {
    clearTimeout(timeout);
  }
}
