// packages/client/lib/http-proxy.ts
export interface ProxyRequest {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64
  hostHeader?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string; // base64
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

  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.body ? Buffer.from(req.body, "base64") : undefined,
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

    // Rewrite Location header if it points to local server
    if (responseHeaders["location"]) {
      const location = responseHeaders["location"];
      const forwardedHost = req.headers["x-forwarded-host"];
      const forwardedProto = req.headers["x-forwarded-proto"] || "http";
      
      if (forwardedHost) {
        try {
          const locUrl = new URL(location, `http://${req.host}:${req.port}`);
          if (locUrl.host === `${req.host}:${req.port}` || locUrl.host === req.host) {
            // It's a redirect to the local server, rewrite to public URL
            let redirectPath = locUrl.pathname + locUrl.search;
            
            // Handle relative redirects (no host in Location header)
            // When Location is relative, new URL() resolves it against base URL
            // which may strip path prefixes (e.g., Next.js i18n stripping default locale)
            // If redirect path exists somewhere in original request path, use original path
            if (!location.match(/^https?:\/\//) && req.path) {
              const redirectPathname = locUrl.pathname;
              const originalPathname = req.path.split("?")[0];
              
              // Check if redirect path is a suffix of original path
              // e.g., original: /id/login/start, redirect: /login/start → use /id/login/start
              if (originalPathname.endsWith(redirectPathname) && redirectPathname !== originalPathname) {
                const prefix = originalPathname.slice(0, originalPathname.length - redirectPathname.length);
                // Only add prefix if it looks like a path prefix (starts with /)
                if (prefix.startsWith("/")) {
                  redirectPath = prefix + redirectPath;
                }
              }
            }
            
            const newLocation = new URL(redirectPath, `${forwardedProto}://${forwardedHost}`);
            responseHeaders["location"] = newLocation.toString();
          }
        } catch {
          // Ignore invalid URLs in Location header
        }
      }
    }

    return {
      status: response.status,
      headers: responseHeaders,
      body: bodyBase64,
    };
  } catch {
    return {
      status: 502,
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("Failed to connect to local server").toString("base64"),
    };
  }
}
