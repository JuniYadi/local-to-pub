// packages/server/index.ts
import { EventEmitter } from "events";
import { createToken, deleteToken, initDb, listTokens, updateSubdomain, validateToken, type TokenDb,
         initConnectionHistory, recordConnection, recordDisconnection, getLiveConnections, getPastConnections } from "./lib/db";
import { TunnelStore } from "./lib/redis";
import { TunnelManager, REQUEST_TIMEOUT_ERROR } from "./lib/tunnel-manager";
import { generateSubdomain, extractSubdomain, isValidSubdomain } from "./lib/subdomain";
import {
  parseClientMessage,
  serializeServerMessage,
  type RequestMessage,
} from "./lib/protocol";
import { embeddedFrontendJs, embeddedFrontendCss, embeddedFrontendHtml } from "./lib/embedded-frontend";
import packageJson from "../../package.json";

declare const VERSION: string | undefined;

// Configuration
const PORT = Number(Bun.env.PORT) || 3000;
const BASE_DOMAIN = Bun.env.BASE_DOMAIN || "localhost:3000";
const REDIS_URL = Bun.env.REDIS_URL || "redis://localhost:6379";
const SERVER_IDLE_TIMEOUT_SECONDS = 130;
const ADMIN_USERNAME = Bun.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = Bun.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = Bun.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_COOKIE = "admin_session";
const FRONTEND_PREFIX = "/static/";
const FRONTEND_ENTRYPOINT = new URL("./frontend.tsx", import.meta.url);
const APP_VERSION = typeof VERSION !== "undefined" && VERSION ? VERSION : packageJson.version;

// Parse CLI arguments for --claim-subdomain flag
let ALLOW_CUSTOM_SUBDOMAINS = (Bun.env.ALLOW_CUSTOM_SUBDOMAINS ?? "true") === "true";
const cliArgs = process.argv.slice(2);

if (cliArgs.includes("--version") || cliArgs.includes("-v")) {
  console.log(`local-to-pub-server v${APP_VERSION}`);
  process.exit(0);
}
const claimSubdomainArg = cliArgs.find(arg => arg.startsWith("--claim-subdomain="));
if (claimSubdomainArg) {
  const value = claimSubdomainArg.split("=")[1];
  ALLOW_CUSTOM_SUBDOMAINS = value === "true";
}

// HTML content - use embedded version in binary, fall back to file read in dev
let FRONTEND_HTML: string;
if (embeddedFrontendHtml) {
  FRONTEND_HTML = embeddedFrontendHtml.toString("utf-8");
} else {
  // Dev mode: read from filesystem
  FRONTEND_HTML = await Bun.file(new URL("./index.html", import.meta.url)).text();
}

const frontendAssets = new Map<string, { blob: Blob; type: string }>();
let frontendReady = false;
let frontendError = "";

// Initialize services
const db: TokenDb = initDb();
initConnectionHistory(db);
const tunnelStore = new TunnelStore(REDIS_URL);
const tunnelManager = new TunnelManager();
const inspectorEvents = new EventEmitter();
inspectorEvents.setMaxListeners(100);

await tunnelStore.connect();

interface WebSocketData {
  subdomain?: string;
  tokenId?: number;
  connectionId?: number;
  authenticated: boolean;
  type: "control" | "tunnel";
  wsRequestId?: string;
  path?: string;
  lastActivity: number;
}

interface SessionPayload {
  username: string;
  exp: number;
}

function ensureAdminConfigured(): string | null {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return "Admin credentials are not configured.";
  }
  if (!SESSION_SECRET) {
    return "Admin session secret is not configured.";
  }
  return null;
}

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(data: string): Uint8Array {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function signSession(payload: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(payload);
  hasher.update("|");
  hasher.update(SESSION_SECRET);
  return hasher.digest("hex");
}

function createSessionToken(username: string): string {
  const payload: SessionPayload = {
    username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = signSession(encoded);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (signSession(encoded) !== signature) return null;

  try {
    const decoded = base64UrlDecode(encoded);
    const payload = JSON.parse(new TextDecoder().decode(decoded)) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (!payload.username) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const parts = header.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (!part) continue;
    const [key, ...rest] = part.split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function getSession(req: Request): SessionPayload | null {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token);
}

function buildSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (Bun.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (Bun.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

async function buildFrontend() {
  // Check for embedded frontend assets (from pre-built binary)
  if (embeddedFrontendJs && embeddedFrontendCss) {
    console.log("Using pre-built embedded frontend assets");
    frontendAssets.set("frontend.js", { blob: new Blob([embeddedFrontendJs], { type: "application/javascript" }), type: "application/javascript" });
    frontendAssets.set("frontend.css", { blob: new Blob([embeddedFrontendCss], { type: "text/css" }), type: "text/css" });
    frontendReady = true;
    return;
  }

  // Fallback: build from source
  const entrypointPath = Bun.fileURLToPath(FRONTEND_ENTRYPOINT);
  const entrypointExists = await Bun.file(entrypointPath).exists();
  if (!entrypointExists) {
    frontendError = "Frontend source not available. Run 'bun run scripts/embed-frontend.ts' first.";
    console.log(frontendError);
    return;
  }

  const build = await Bun.build({
    entrypoints: [entrypointPath],
    target: "browser",
    minify: Bun.env.NODE_ENV === "production",
  });

  if (!build.success) {
    frontendError = "Frontend build failed.";
    console.error(frontendError);
    for (const log of build.logs) {
      console.error(log.message);
    }
    return;
  }

  for (const output of build.outputs) {
    const name = output.path.split("/").pop() ?? output.path;
    frontendAssets.set(name, { blob: output, type: output.type });
  }

  frontendReady = frontendAssets.has("frontend.js") && frontendAssets.has("frontend.css");
  if (!frontendReady) {
    frontendError = "Frontend assets are missing.";
    console.error(frontendError);
  }
}

function serveFrontendAsset(pathname: string): Response | null {
  if (!pathname.startsWith(FRONTEND_PREFIX)) {
    return null;
  }
  const name = pathname.slice(FRONTEND_PREFIX.length);
  const asset = frontendAssets.get(name);
  if (!asset) {
    return null;
  }
  return new Response(asset.blob, {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": "no-store",
    },
  });
}

await buildFrontend();

const server = Bun.serve<WebSocketData>({
  port: PORT,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS, // 130 seconds

  async fetch(req, _server) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "";

    // Check if this is the main domain (system routes)
    const isMainDomain = host === BASE_DOMAIN || host.startsWith("localhost");

    if (isMainDomain) {
      // System routes
      if (url.pathname.startsWith(FRONTEND_PREFIX) && req.method === "GET") {
        const asset = serveFrontendAsset(url.pathname);
        if (asset) {
          return asset;
        }
        return new Response("Not Found", { status: 404 });
      }

      if (url.pathname === "/" && req.method === "GET") {
        if (!frontendReady) {
          return new Response(frontendError || "Frontend unavailable.", { status: 500 });
        }
        return new Response(FRONTEND_HTML, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.pathname === "/tunnel") {
        // Upgrade to WebSocket
        const upgraded = server.upgrade(req, {
          data: { authenticated: false, type: "control", lastActivity: Date.now() },
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

      if (url.pathname === "/api/login" && req.method === "POST") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        let body: { username?: string; password?: string } = {};
        try {
          body = (await req.json()) as { username?: string; password?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
          return Response.json({ error: "Invalid credentials." }, { status: 401 });
        }
        const sessionToken = createSessionToken(body.username);
        const headers = new Headers({
          "Set-Cookie": buildSessionCookie(sessionToken),
        });
        return Response.json({ username: body.username }, { headers });
      }

      if (url.pathname === "/api/logout" && req.method === "POST") {
        const headers = new Headers({
          "Set-Cookie": clearSessionCookie(),
        });
        return Response.json({ ok: true }, { headers });
      }

      if (url.pathname === "/api/me" && req.method === "GET") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        return Response.json({ username: session.username });
      }

      if (url.pathname === "/api/tokens" && req.method === "GET") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        return Response.json({ tokens: listTokens(db) });
      }

      if (url.pathname === "/api/tokens" && req.method === "POST") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        const token = createToken(db);
        return Response.json({ token });
      }

      if (url.pathname === "/api/tokens/subdomain" && req.method === "POST") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        let body: { id?: number; subdomain?: string } = {};
        try {
          body = (await req.json()) as { id?: number; subdomain?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        if (typeof body.id !== "number" || (body.subdomain !== null && typeof body.subdomain !== "string")) {
          return Response.json({ error: "Invalid parameters." }, { status: 400 });
        }
        const success = updateSubdomain(db, body.id, body.subdomain || null);
        if (!success) {
          return Response.json({ error: "Could not update subdomain. It might be already taken." }, { status: 409 });
        }
        return Response.json({ ok: true });
      }

      if (url.pathname === "/api/subdomain-check" && req.method === "GET") {
        const uri = url.searchParams.get("uri");
        if (!uri) {
          return Response.json({ available: false, error: "Missing uri parameter" }, { status: 400 });
        }

        if (!isValidSubdomain(uri)) {
          return Response.json({ available: false, error: "Invalid subdomain format", uri }, { status: 400 });
        }

        const isTaken = await tunnelStore.exists(uri) || tunnelManager.getConnection(uri);
        return Response.json({ available: !isTaken, uri });
      }

      if (url.pathname === "/api/inspector/stream" && req.method === "GET") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        const signal = req.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              const onEvent = (type: string, data: object) => {
                const payload = JSON.stringify({ type, ...data });
                controller.enqueue(`data: ${payload}\n\n`);
              };

              const onRequest = (data: object) => onEvent("request", data);
              const onResponse = (data: object) => onEvent("response", data);

              inspectorEvents.on("request", onRequest);
              inspectorEvents.on("response", onResponse);

              signal.addEventListener("abort", () => {
                inspectorEvents.off("request", onRequest);
                inspectorEvents.off("response", onResponse);
                controller.close();
              });
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }
        );
      }

      if (url.pathname === "/api/connections" && req.method === "GET") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        const live = getLiveConnections(db);
        const past = getPastConnections(db);
        return Response.json({ live, past });
      }

      if (url.pathname === "/api/connections/disconnect" && req.method === "POST") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        let body: { subdomain?: string } = {};
        try {
          body = (await req.json()) as { subdomain?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        if (!body.subdomain) {
          return Response.json({ error: "Missing subdomain." }, { status: 400 });
        }

        const ws = tunnelManager.getConnection(body.subdomain);
        if (!ws) {
          return Response.json({ error: "No active connection for this subdomain." }, { status: 404 });
        }

        const existingData = ws.data as WebSocketData;
        if (existingData.connectionId) {
          recordDisconnection(db, existingData.connectionId);
        }

        tunnelManager.closeConnection(body.subdomain);
        await tunnelStore.unregister(body.subdomain);

        console.log(`Admin force-disconnected: ${body.subdomain}`);
        return Response.json({ ok: true });
      }

      if (url.pathname === "/api/connections/disconnect-all" && req.method === "POST") {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        const subdomains = tunnelManager.getActiveSubdomains();
        if (subdomains.length === 0) {
          return Response.json({ ok: true, disconnected: 0 });
        }

        let count = 0;
        for (const subdomain of subdomains) {
          const ws = tunnelManager.getConnection(subdomain);
          if (ws) {
            const existingData = ws.data as WebSocketData;
            if (existingData.connectionId) {
              recordDisconnection(db, existingData.connectionId);
            }
            tunnelManager.closeConnection(subdomain);
            await tunnelStore.unregister(subdomain);
            count++;
            console.log(`Admin force-disconnected: ${subdomain}`);
          }
        }

        return Response.json({ ok: true, disconnected: count });
      }

      const deleteTokenMatch = url.pathname.match(/^\/api\/tokens\/(\d+)$/);
      if (req.method === "DELETE" && deleteTokenMatch) {
        const configError = ensureAdminConfigured();
        if (configError) {
          return Response.json({ error: configError }, { status: 500 });
        }
        const session = getSession(req);
        if (!session) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        const tokenId = Number(deleteTokenMatch[1]);
        if (Number.isNaN(tokenId) || tokenId <= 0) {
          return Response.json({ error: "Invalid token id." }, { status: 400 });
        }
        const deleted = deleteToken(db, tokenId);
        if (!deleted) {
          return Response.json({ error: "Token not found." }, { status: 404 });
        }
        return Response.json({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    }

    // Tunnel request - extract subdomain
    const subdomain = extractSubdomain(host, BASE_DOMAIN);
    if (!subdomain) {
      return new Response("Invalid subdomain", { status: 400 });
    }

    // Check if this is a WebSocket upgrade request for a tunnel
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const wsRequestId = Bun.randomUUIDv7();
      const upgraded = server.upgrade(req, {
        data: {
          authenticated: true,
          type: "tunnel",
          subdomain,
          wsRequestId,
          path: url.pathname + url.search, // Store path for the 'open' event
          lastActivity: Date.now(),
        },
      });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // Check if tunnel exists
    const ws = tunnelManager.getConnection(subdomain);
    if (!ws) {
      return new Response("Tunnel not connected", { status: 502 });
    }

    // Forward request through WebSocket
    const requestId = Bun.randomUUIDv7();
    const body = req.body ? Buffer.from(await req.arrayBuffer()).toString("base64") : "";

    const headers = Object.fromEntries(req.headers.entries());
    
    // Add X-Forwarded headers
    headers["x-forwarded-host"] = host;
    headers["x-forwarded-proto"] = url.protocol.replace(":", "");
    headers["x-forwarded-for"] = server.requestIP(req)?.address || "";

    const requestMsg: RequestMessage = {
      type: "request",
      requestId,
      method: req.method,
      path: url.pathname + url.search,
      headers,
      body,
    };

    // Emit request for inspector
    inspectorEvents.emit("request", {
      requestId,
      subdomain,
      timestamp: Date.now(),
      method: requestMsg.method,
      path: requestMsg.path,
      headers: requestMsg.headers,
      body: requestMsg.body,
    });

    ws.send(serializeServerMessage(requestMsg));

    try {
      const response = await tunnelManager.waitForResponse(requestId, subdomain);

      // Emit response for inspector
      inspectorEvents.emit("response", {
        requestId,
        subdomain,
        timestamp: Date.now(),
        status: response.status,
        headers: response.headers,
        body: response.body,
      });

      return new Response(Buffer.from(response.body, "base64"), {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (error instanceof Error && error.message === REQUEST_TIMEOUT_ERROR && tunnelManager.getConnection(subdomain) === ws) {
        const wsData = ws.data as WebSocketData;
        if (wsData.connectionId) {
          recordDisconnection(db, wsData.connectionId);
        }
        tunnelManager.closeConnection(subdomain);
        await tunnelStore.unregister(subdomain);
        console.log(`Closed unresponsive tunnel after request timeout: ${subdomain}`);
      }
      return new Response("Gateway Timeout", { status: 504 });
    }
  },

  websocket: {
    open(ws) {
      const data = ws.data;
      if (data.type === "control") {
        console.log("Control WebSocket connected, waiting for auth...");
      } else if (data.type === "tunnel") {
        const subdomain = data.subdomain!;
        const wsRequestId = data.wsRequestId!;
        const controlWs = tunnelManager.getConnection(subdomain);

        if (!controlWs) {
          ws.close();
          return;
        }

        // Register the browser connection
        tunnelManager.registerBrowserConnection(wsRequestId, subdomain, ws);

        // Notify the client to open a local WebSocket
        controlWs.send(serializeServerMessage({
          type: "ws_open",
          requestId: wsRequestId,
          path: data.path || "/",
          headers: {}, // We'll pass actual headers in the future if needed
        }));
      }
    },

    async message(ws, message) {
      const data = ws.data;
      data.lastActivity = Date.now();

      if (data.type === "tunnel") {
        const encodedData = typeof message === "string" ? Buffer.from(message).toString("base64") : Buffer.from(message).toString("base64");
        const result = tunnelManager.queueBrowserMessage(data.wsRequestId!, encodedData);

        if (!result) {
          ws.close();
          return;
        }

        if (!result.ready) {
          return;
        }

        const controlWs = tunnelManager.getConnection(result.subdomain);
        if (controlWs) {
          controlWs.send(serializeServerMessage({
            type: "ws_data",
            requestId: data.wsRequestId!,
            data: encodedData,
          }));
        }
        return;
      }

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

        // Determine subdomain
        let subdomain: string;
        if (parsed.requestedSubdomain) {
          // Client requested a specific subdomain - check if allowed
          if (!ALLOW_CUSTOM_SUBDOMAINS) {
            ws.send(serializeServerMessage({
              type: "auth_error",
              message: "Custom subdomain requests are disabled on this server. Please reconnect without the --uri flag, or configure a persistent subdomain for your token."
            }));
            ws.close();
            return;
          }
          // Client requested a specific subdomain
          if (!isValidSubdomain(parsed.requestedSubdomain)) {
            ws.send(serializeServerMessage({ type: "auth_error", message: "Invalid subdomain format" }));
            ws.close();
            return;
          }

          // Check if subdomain is already in use
          const existingWS = tunnelManager.getConnection(parsed.requestedSubdomain);
          if (existingWS) {
            const existingData = existingWS.data as WebSocketData;
            if (existingData.tokenId === tokenRecord.id) {
              console.log(`Reconnecting same token to subdomain: ${parsed.requestedSubdomain}. Closing old connection.`);
              if (existingData.connectionId) {
                recordDisconnection(db, existingData.connectionId);
              }
              existingWS.close();
              tunnelManager.unregisterConnection(parsed.requestedSubdomain);
              await tunnelStore.unregister(parsed.requestedSubdomain);
            } else if (parsed.force && existingWS.readyState !== WebSocket.OPEN) {
              console.log(`Force-taking dead subdomain: ${parsed.requestedSubdomain}. Closing stale connection.`);
              if (existingData.connectionId) {
                recordDisconnection(db, existingData.connectionId);
              }
              existingWS.close();
              tunnelManager.unregisterConnection(parsed.requestedSubdomain);
              await tunnelStore.unregister(parsed.requestedSubdomain);
            } else if (parsed.force) {
              // Connection is still alive - force not allowed
              ws.send(serializeServerMessage({ type: "auth_error", message: "Subdomain is currently active. Use admin dashboard to disconnect it first." }));
              ws.close();
              return;
            } else {
              ws.send(serializeServerMessage({ type: "auth_error", message: "Subdomain already in use" }));
              ws.close();
              return;
            }
          }

          subdomain = parsed.requestedSubdomain;
        } else if (tokenRecord.subdomain) {
          subdomain = tokenRecord.subdomain;

          // Check if persistent subdomain is already in use
          const existingWS = tunnelManager.getConnection(subdomain);
          if (existingWS) {
            const existingData = existingWS.data as WebSocketData;
            if (existingData.tokenId === tokenRecord.id) {
              console.log(`Reconnecting same token to persistent subdomain: ${subdomain}. Closing old connection.`);
              if (existingData.connectionId) {
                recordDisconnection(db, existingData.connectionId);
              }
              existingWS.close();
              tunnelManager.unregisterConnection(subdomain);
              await tunnelStore.unregister(subdomain);
            } else if (parsed.force && existingWS.readyState !== WebSocket.OPEN) {
              console.log(`Force-taking dead persistent subdomain: ${subdomain}. Closing stale connection.`);
              if (existingData.connectionId) {
                recordDisconnection(db, existingData.connectionId);
              }
              existingWS.close();
              tunnelManager.unregisterConnection(subdomain);
              await tunnelStore.unregister(subdomain);
            } else if (parsed.force) {
              // Connection is still alive - force not allowed
              ws.send(serializeServerMessage({ type: "auth_error", message: "Subdomain is currently active. Use admin dashboard to disconnect it first." }));
              ws.close();
              return;
            } else {
              ws.send(serializeServerMessage({ type: "auth_error", message: "Subdomain already in use" }));
              ws.close();
              return;
            }
          }
        } else {
          // Generate unique subdomain
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

        // Record connection in history
        data.connectionId = recordConnection(db, subdomain, tokenRecord.id);

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

      if (parsed.type === "ws_ready") {
        const ready = tunnelManager.markBrowserConnectionReady(parsed.requestId);
        if (!ready) return;

        const controlWs = tunnelManager.getConnection(ready.subdomain);
        if (!controlWs) {
          const browserWs = tunnelManager.getBrowserConnection(parsed.requestId);
          if (browserWs) {
            browserWs.close();
          }
          tunnelManager.unregisterBrowserConnection(parsed.requestId);
          return;
        }

        for (const data of ready.messages) {
          controlWs.send(serializeServerMessage({
            type: "ws_data",
            requestId: parsed.requestId,
            data,
          }));
        }
      }

      if (parsed.type === "ws_data") {
        const browserWs = tunnelManager.getBrowserConnection(parsed.requestId);
        if (browserWs) {
          browserWs.send(Buffer.from(parsed.data, "base64"));
        }
      }

      if (parsed.type === "ws_close") {
        const browserWs = tunnelManager.getBrowserConnection(parsed.requestId);
        if (browserWs) {
          browserWs.close();
          tunnelManager.unregisterBrowserConnection(parsed.requestId);
        }
      }

      if (parsed.type === "pong") {
        // Application-level pong received (response to server ping)
        // lastActivity already updated above
      }
    },

    pong(_ws) {
      // WebSocket-level pong received (response to ws.ping())
      // Intentionally NOT updating lastActivity here — auto-pong from the TCP stack
      // doesn't indicate the application is alive. Only application-level messages
      // (responses, app-level pong, etc.) count as activity.
    },

    async close(ws) {
      const data = ws.data;
      if (data.type === "control" && data.subdomain) {
        // Record disconnection in history
        if (data.connectionId) {
          recordDisconnection(db, data.connectionId);
        }
        await tunnelStore.unregister(data.subdomain);
        tunnelManager.unregisterConnection(data.subdomain);
        console.log(`Tunnel disconnected: ${data.subdomain}`);
      } else if (data.type === "tunnel" && data.wsRequestId) {
        const controlWs = tunnelManager.getConnection(data.subdomain!);
        if (controlWs) {
          controlWs.send(serializeServerMessage({
            type: "ws_close",
            requestId: data.wsRequestId,
          }));
        }
        tunnelManager.unregisterBrowserConnection(data.wsRequestId);
      }
    },
  },
});

console.log(`Server running on http://${server.hostname}:${server.port}`);
console.log(`Base domain: ${BASE_DOMAIN}`);

// ── Ping / keepalive ──
// Send application-level ping messages every 15 seconds to all control connections.
// The client must respond with { type: "pong" } in its message handler.
// This detects hung clients where TCP is alive but the app is stuck.
const PING_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 15_000;
const pingTimer = setInterval(() => {
  for (const subdomain of tunnelManager.getActiveSubdomains()) {
    const ws = tunnelManager.getConnection(subdomain);
    if (ws) {
      try { ws.send(serializeServerMessage({ type: "ping" })); } catch { /* connection may be closed */ }
    }
  }
}, PING_INTERVAL_MS);

// ── Inactivity cleanup ──
// Every 15 seconds, close connections that have been inactive for > 45 seconds.
// "Inactive" means no message received from the client (including pong responses).
const cleanupTimer = setInterval(async () => {
  const now = Date.now();
  for (const subdomain of tunnelManager.getActiveSubdomains()) {
    const ws = tunnelManager.getConnection(subdomain);
    if (!ws) continue;
    const data = ws.data as WebSocketData;
    const idleMs = now - data.lastActivity;
    if (idleMs >= HEARTBEAT_TIMEOUT_MS) {
      console.log(`Closing unresponsive tunnel: ${subdomain} (no app-level message for ${Math.round(idleMs / 1000)}s)`);
      if (data.connectionId) {
        recordDisconnection(db, data.connectionId);
      }
      tunnelManager.closeConnection(subdomain);
      await tunnelStore.unregister(subdomain);
    }
  }
}, HEARTBEAT_CHECK_INTERVAL_MS);

// Allow garbage collection on shutdown
process.on("SIGINT", () => {
  clearInterval(pingTimer);
  clearInterval(cleanupTimer);
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(pingTimer);
  clearInterval(cleanupTimer);
  process.exit(0);
});
