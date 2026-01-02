// packages/client/lib/http-proxy.ts
export interface ProxyRequest {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string; // base64
}

export async function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const url = `http://${req.host}:${req.port}${req.path}`;

  // Filter out hop-by-hop headers
  const headers = new Headers();
  const skipHeaders = new Set([
    "host", "connection", "keep-alive", "transfer-encoding",
    "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization",
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.body ? Buffer.from(req.body, "base64") : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    const bodyBuffer = await response.arrayBuffer();
    const bodyBase64 = Buffer.from(bodyBuffer).toString("base64");

    return {
      status: response.status,
      headers: responseHeaders,
      body: bodyBase64,
    };
  } catch (error) {
    return {
      status: 502,
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("Failed to connect to local server").toString("base64"),
    };
  }
}
