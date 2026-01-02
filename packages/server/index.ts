// packages/server/index.ts
import { initDb, validateToken, type TokenDb } from "./lib/db";
import { TunnelStore } from "./lib/redis";
import { TunnelManager } from "./lib/tunnel-manager";
import { generateSubdomain, extractSubdomain } from "./lib/subdomain";
import {
  parseClientMessage,
  serializeServerMessage,
  type RequestMessage,
} from "./lib/protocol";

// Configuration
const PORT = Number(Bun.env.PORT) || 3000;
const BASE_DOMAIN = Bun.env.BASE_DOMAIN || "localhost:3000";
const REDIS_URL = Bun.env.REDIS_URL || "redis://localhost:6379";

// Initialize services
const db: TokenDb = initDb();
const tunnelStore = new TunnelStore(REDIS_URL);
const tunnelManager = new TunnelManager();

await tunnelStore.connect();

interface WebSocketData {
  subdomain?: string;
  tokenId?: number;
  authenticated: boolean;
}

const server = Bun.serve<WebSocketData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "";

    // Check if this is the main domain (system routes)
    const isMainDomain = host === BASE_DOMAIN || host.startsWith("localhost");

    if (isMainDomain) {
      // System routes
      if (url.pathname === "/tunnel") {
        // Upgrade to WebSocket
        const upgraded = server.upgrade(req, {
          data: { authenticated: false },
        });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          connections: tunnelManager.getConnectionCount(),
          timestamp: new Date().toISOString(),
        });
      }

      if (url.pathname === "/api/tokens" && req.method === "POST") {
        // Create new token (should be protected in production)
        const { createToken } = await import("./lib/db");
        const token = createToken(db);
        return Response.json({ token });
      }

      return new Response("Not Found", { status: 404 });
    }

    // Tunnel request - extract subdomain
    const subdomain = extractSubdomain(host, BASE_DOMAIN);
    if (!subdomain) {
      return new Response("Invalid subdomain", { status: 400 });
    }

    // Check if tunnel exists
    const ws = tunnelManager.getConnection(subdomain);
    if (!ws) {
      return new Response("Tunnel not connected", { status: 502 });
    }

    // Forward request through WebSocket
    const requestId = crypto.randomUUID();
    const body = req.body ? Buffer.from(await req.arrayBuffer()).toString("base64") : "";

    const requestMsg: RequestMessage = {
      type: "request",
      requestId,
      method: req.method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(req.headers.entries()),
      body,
    };

    ws.send(serializeServerMessage(requestMsg));

    try {
      const response = await tunnelManager.waitForResponse(requestId, subdomain);

      return new Response(Buffer.from(response.body, "base64"), {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      return new Response("Gateway Timeout", { status: 504 });
    }
  },

  websocket: {
    open(ws) {
      console.log("WebSocket connected, waiting for auth...");
    },

    async message(ws, message) {
      const data = ws.data;
      const msgStr = typeof message === "string" ? message : message.toString();
      const parsed = parseClientMessage(msgStr);

      if (!parsed) {
        ws.send(serializeServerMessage({ type: "auth_error", message: "Invalid message" }));
        return;
      }

      if (parsed.type === "auth") {
        if (data.authenticated) {
          return; // Already authenticated
        }

        const tokenRecord = validateToken(db, parsed.token);
        if (!tokenRecord) {
          ws.send(serializeServerMessage({ type: "auth_error", message: "Invalid token" }));
          ws.close();
          return;
        }

        // Generate unique subdomain
        let subdomain: string;
        let attempts = 0;
        do {
          subdomain = generateSubdomain();
          attempts++;
        } while (await tunnelStore.exists(subdomain) && attempts < 10);

        if (attempts >= 10) {
          ws.send(serializeServerMessage({ type: "auth_error", message: "Could not generate subdomain" }));
          ws.close();
          return;
        }

        // Register tunnel
        await tunnelStore.register(subdomain, {
          tokenId: tokenRecord.id,
          connectedAt: Date.now(),
          localPort: 0, // Client will update
        });

        tunnelManager.registerConnection(subdomain, ws);

        data.authenticated = true;
        data.subdomain = subdomain;
        data.tokenId = tokenRecord.id;

        const protocol = Bun.env.NODE_ENV === "production" ? "https" : "http";
        const url = `${protocol}://${subdomain}.${BASE_DOMAIN}`;

        ws.send(serializeServerMessage({
          type: "auth_ok",
          subdomain,
          url,
        }));

        console.log(`Tunnel registered: ${subdomain}`);
      }

      if (parsed.type === "response") {
        if (!data.authenticated) {
          return;
        }

        tunnelManager.resolvePendingRequest(parsed.requestId, {
          status: parsed.status,
          headers: parsed.headers,
          body: parsed.body,
        });
      }
    },

    async close(ws) {
      const data = ws.data;
      if (data.subdomain) {
        await tunnelStore.unregister(data.subdomain);
        tunnelManager.unregisterConnection(data.subdomain);
        console.log(`Tunnel disconnected: ${data.subdomain}`);
      }
    },
  },
});

console.log(`Server running on http://localhost:${PORT}`);
console.log(`Base domain: ${BASE_DOMAIN}`);
