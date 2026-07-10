// packages/client/lib/http-proxy.ts
export const LOCAL_REQUEST_TIMEOUT_MS = 120_000;

export interface ProxyRequest {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64
  hostHeader?: string;
  timeoutMs?: number;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string; // base64
}

function rewriteRedirectLocation(location: string, req: ProxyRequest): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedProto = req.headers["x-forwarded-proto"] || "http";

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
    const originalPathname = req.path.split("?")[0];

    if (originalPathname.endsWith(redirectPathname) && redirectPathname !== originalPathname) {
      const prefix = originalPathname.slice(0, originalPathname.length - redirectPathname.length);
      if (prefix.startsWith("/")) {
        redirectPath = prefix + redirectPath;
      }
    }
  }

  return new URL(redirectPath, `${forwardedProto}://${forwardedHost}`).toString();
}

export async function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const url = `http://${req.host}:${req.port}${req.path}`;

  // Filter out hop-by-hop and encoding headers
  const headers = new Headers();
  const skipRequestHeaders = new Set([
    "host", "connection", "keep-alive", "transfer-encoding",
    "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization",
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipRequestHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Set Host header if overridden
  if (req.hostHeader) {
    headers.set("host", req.hostHeader);
  } else {
    headers.set("host", `${req.host}:${req.port}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? LOCAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.body ? Buffer.from(req.body, "base64") : undefined,
      redirect: "manual",
      signal: controller.signal,
    });

    const responseHeaders: Record<string, string> = {};
    const skipResponseHeaders = new Set([
      "connection", "keep-alive", "transfer-encoding",
      "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization",
      "content-encoding", "content-length"
    ]);

    response.headers.forEach((value, key) => {
      if (!skipResponseHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    const bodyBuffer = await response.arrayBuffer();
    const bodyBase64 = Buffer.from(bodyBuffer).toString("base64");

    if (responseHeaders["location"]) {
      try {
        responseHeaders["location"] = rewriteRedirectLocation(responseHeaders["location"], req);
      } catch {
        // Ignore invalid URLs in Location header
      }
    }

    return {
      status: response.status,
      headers: responseHeaders,
      body: bodyBase64,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        status: 504,
        headers: { "Content-Type": "text/plain" },
        body: Buffer.from("Local server timed out").toString("base64"),
      };
    }
    return {
      status: 502,
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("Failed to connect to local server").toString("base64"),
    };
  } finally {
    clearTimeout(timeout);
  }
}
