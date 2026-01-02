# Local-to-Pub Tunnel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted tunnel server and client that forwards HTTP traffic from public subdomains to localhost.

**Architecture:** Monorepo with `packages/server` (VPS) and `packages/client` (local machine). Server uses Bun.serve() with WebSocket upgrade. Client connects via WebSocket and proxies requests to localhost.

**Tech Stack:** Bun runtime, bun:sqlite, Bun.redis, WebSocket

---

## Task 1: Setup Monorepo Structure

**Files:**
- Create: `package.json` (modify existing)
- Create: `packages/server/package.json`
- Create: `packages/client/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/client/tsconfig.json`

**Step 1: Update root package.json for workspaces**

```json
{
  "name": "local-to-pub",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:server": "bun run --filter @local-to-pub/server dev",
    "dev:client": "bun run --filter @local-to-pub/client dev",
    "test": "bun test"
  }
}
```

**Step 2: Create server package.json**

```json
{
  "name": "@local-to-pub/server",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun --hot run index.ts",
    "start": "bun run index.ts",
    "test": "bun test"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Step 3: Create client package.json**

```json
{
  "name": "@local-to-pub/client",
  "version": "0.0.1",
  "private": true,
  "bin": {
    "tunnel": "./index.ts"
  },
  "scripts": {
    "dev": "bun run index.ts",
    "start": "bun run index.ts",
    "test": "bun test"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Step 4: Create server tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["**/*.ts"]
}
```

**Step 5: Create client tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["**/*.ts"]
}
```

**Step 6: Create placeholder entry files**

Server `packages/server/index.ts`:
```typescript
console.log("Server starting...");
```

Client `packages/client/index.ts`:
```typescript
console.log("Client starting...");
```

**Step 7: Run bun install**

Run: `bun install`
Expected: Installs dependencies for all workspaces

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: setup monorepo structure with server and client packages"
```

---

## Task 2: Server - SQLite Database for Tokens

**Files:**
- Create: `packages/server/lib/db.ts`
- Create: `packages/server/lib/db.test.ts`

**Step 1: Write failing test for database initialization**

```typescript
// packages/server/lib/db.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, createToken, validateToken, type TokenDb } from "./db";

describe("Token Database", () => {
  let db: TokenDb;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("initDb creates tokens table", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'")
      .get();
    expect(tables).toBeTruthy();
  });

  test("createToken returns a token string", () => {
    const token = createToken(db);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  test("validateToken returns true for valid token", () => {
    const token = createToken(db);
    const result = validateToken(db, token);
    expect(result).not.toBeNull();
    expect(result?.id).toBeGreaterThan(0);
  });

  test("validateToken returns null for invalid token", () => {
    const result = validateToken(db, "invalid-token");
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/server/lib/db.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// packages/server/lib/db.ts
import { Database } from "bun:sqlite";

export type TokenDb = Database;

export interface TokenRecord {
  id: number;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export function initDb(path: string = "tunnel.db"): TokenDb {
  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME
    )
  `);

  return db;
}

export function createToken(db: TokenDb): string {
  const token = generateSecureToken();
  const hash = hashToken(token);

  db.query("INSERT INTO tokens (token_hash) VALUES (?)").run(hash);

  return token;
}

export function validateToken(db: TokenDb, token: string): TokenRecord | null {
  const hash = hashToken(token);

  const record = db
    .query("SELECT * FROM tokens WHERE token_hash = ?")
    .get(hash) as TokenRecord | null;

  if (record) {
    db.query("UPDATE tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(record.id);
  }

  return record;
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/server/lib/db.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/server/lib/db.ts packages/server/lib/db.test.ts
git commit -m "feat(server): add SQLite database for token management"
```

---

## Task 3: Server - Subdomain Generator

**Files:**
- Create: `packages/server/lib/subdomain.ts`
- Create: `packages/server/lib/subdomain.test.ts`

**Step 1: Write failing test**

```typescript
// packages/server/lib/subdomain.test.ts
import { describe, test, expect } from "bun:test";
import { generateSubdomain, isValidSubdomain } from "./subdomain";

describe("Subdomain", () => {
  test("generateSubdomain returns 6 character string", () => {
    const subdomain = generateSubdomain();
    expect(subdomain.length).toBe(6);
  });

  test("generateSubdomain only contains lowercase alphanumeric", () => {
    const subdomain = generateSubdomain();
    expect(subdomain).toMatch(/^[a-z0-9]+$/);
  });

  test("generateSubdomain returns unique values", () => {
    const subdomains = new Set<string>();
    for (let i = 0; i < 100; i++) {
      subdomains.add(generateSubdomain());
    }
    expect(subdomains.size).toBe(100);
  });

  test("isValidSubdomain validates correctly", () => {
    expect(isValidSubdomain("abc123")).toBe(true);
    expect(isValidSubdomain("ABC123")).toBe(false);
    expect(isValidSubdomain("abc-123")).toBe(false);
    expect(isValidSubdomain("ab")).toBe(false);
    expect(isValidSubdomain("")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/server/lib/subdomain.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// packages/server/lib/subdomain.ts
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUBDOMAIN_LENGTH = 6;

export function generateSubdomain(): string {
  const bytes = new Uint8Array(SUBDOMAIN_LENGTH);
  crypto.getRandomValues(bytes);

  let result = "";
  for (let i = 0; i < SUBDOMAIN_LENGTH; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return result;
}

export function isValidSubdomain(subdomain: string): boolean {
  if (subdomain.length < 3 || subdomain.length > 20) {
    return false;
  }
  return /^[a-z0-9]+$/.test(subdomain);
}

export function extractSubdomain(host: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }
  const subdomain = host.slice(0, -suffix.length);
  if (!isValidSubdomain(subdomain)) {
    return null;
  }
  return subdomain;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/server/lib/subdomain.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/server/lib/subdomain.ts packages/server/lib/subdomain.test.ts
git commit -m "feat(server): add subdomain generator and validator"
```

---

## Task 4: Server - Redis for Active Tunnels

**Files:**
- Create: `packages/server/lib/redis.ts`
- Create: `packages/server/lib/redis.test.ts`

**Step 1: Write failing test**

```typescript
// packages/server/lib/redis.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TunnelStore, type TunnelInfo } from "./redis";

describe("TunnelStore", () => {
  let store: TunnelStore;

  beforeEach(async () => {
    store = new TunnelStore(Bun.env.REDIS_URL || "redis://localhost:6379");
    await store.connect();
    // Clean up test keys
    await store.clear("test-");
  });

  afterEach(async () => {
    await store.clear("test-");
    await store.disconnect();
  });

  test("register and get tunnel", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    await store.register("test-abc123", info);
    const result = await store.get("test-abc123");

    expect(result).not.toBeNull();
    expect(result?.tokenId).toBe(1);
    expect(result?.localPort).toBe(3000);
  });

  test("unregister removes tunnel", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    await store.register("test-xyz789", info);
    await store.unregister("test-xyz789");
    const result = await store.get("test-xyz789");

    expect(result).toBeNull();
  });

  test("exists returns correct status", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    expect(await store.exists("test-notexist")).toBe(false);
    await store.register("test-exists", info);
    expect(await store.exists("test-exists")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/server/lib/redis.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// packages/server/lib/redis.ts
export interface TunnelInfo {
  tokenId: number;
  connectedAt: number;
  localPort: number;
}

const KEY_PREFIX = "tunnel:";

export class TunnelStore {
  private redis: ReturnType<typeof Bun.redis> | null = null;
  private url: string;

  constructor(url: string = "redis://localhost:6379") {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.redis = Bun.redis(this.url);
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async register(subdomain: string, info: TunnelInfo): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    await this.redis.set(key, JSON.stringify(info));
  }

  async unregister(subdomain: string): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    await this.redis.del(key);
  }

  async get(subdomain: string): Promise<TunnelInfo | null> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    const data = await this.redis.get(key);

    if (!data) return null;
    return JSON.parse(data) as TunnelInfo;
  }

  async exists(subdomain: string): Promise<boolean> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    return (await this.redis.exists(key)) === 1;
  }

  async clear(prefix: string = ""): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const pattern = `${KEY_PREFIX}${prefix}*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/server/lib/redis.test.ts`
Expected: PASS (all 3 tests) - requires Redis running locally

**Step 5: Commit**

```bash
git add packages/server/lib/redis.ts packages/server/lib/redis.test.ts
git commit -m "feat(server): add Redis store for active tunnels"
```

---

## Task 5: Server - WebSocket Protocol Types

**Files:**
- Create: `packages/server/lib/protocol.ts`

**Step 1: Create shared protocol types**

```typescript
// packages/server/lib/protocol.ts

// Client → Server messages
export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface ResponseMessage {
  type: "response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string; // base64 encoded
}

export type ClientMessage = AuthMessage | ResponseMessage;

// Server → Client messages
export interface AuthOkMessage {
  type: "auth_ok";
  subdomain: string;
  url: string;
}

export interface AuthErrorMessage {
  type: "auth_error";
  message: string;
}

export interface RequestMessage {
  type: "request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64 encoded
}

export type ServerMessage = AuthOkMessage | AuthErrorMessage | RequestMessage;

// Helper functions
export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data);
    if (msg.type === "auth" && typeof msg.token === "string") {
      return msg as AuthMessage;
    }
    if (msg.type === "response" && typeof msg.requestId === "string") {
      return msg as ResponseMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
```

**Step 2: Commit**

```bash
git add packages/server/lib/protocol.ts
git commit -m "feat(server): add WebSocket protocol types"
```

---

## Task 6: Server - Tunnel Manager

**Files:**
- Create: `packages/server/lib/tunnel-manager.ts`
- Create: `packages/server/lib/tunnel-manager.test.ts`

**Step 1: Write failing test**

```typescript
// packages/server/lib/tunnel-manager.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { TunnelManager } from "./tunnel-manager";

describe("TunnelManager", () => {
  let manager: TunnelManager;

  beforeEach(() => {
    manager = new TunnelManager();
  });

  test("registerConnection stores WebSocket by subdomain", () => {
    const mockWs = { send: mock(() => {}) } as any;
    manager.registerConnection("abc123", mockWs);

    expect(manager.getConnection("abc123")).toBe(mockWs);
  });

  test("unregisterConnection removes WebSocket", () => {
    const mockWs = { send: mock(() => {}) } as any;
    manager.registerConnection("abc123", mockWs);
    manager.unregisterConnection("abc123");

    expect(manager.getConnection("abc123")).toBeUndefined();
  });

  test("getConnection returns undefined for unknown subdomain", () => {
    expect(manager.getConnection("unknown")).toBeUndefined();
  });

  test("hasPendingRequest tracks requests", () => {
    const mockWs = { send: mock(() => {}) } as any;
    manager.registerConnection("abc123", mockWs);

    const requestId = manager.createPendingRequest("abc123");
    expect(manager.hasPendingRequest(requestId)).toBe(true);

    manager.resolvePendingRequest(requestId, { status: 200, headers: {}, body: "" });
    expect(manager.hasPendingRequest(requestId)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/server/lib/tunnel-manager.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// packages/server/lib/tunnel-manager.ts
import type { ServerWebSocket } from "bun";

export interface PendingRequest {
  subdomain: string;
  resolve: (response: HttpResponse) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string; // base64
}

export interface TunnelConnection {
  ws: ServerWebSocket<unknown>;
  tokenId: number;
  subdomain: string;
  connectedAt: number;
}

export class TunnelManager {
  private connections = new Map<string, ServerWebSocket<unknown>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  registerConnection(subdomain: string, ws: ServerWebSocket<unknown>): void {
    this.connections.set(subdomain, ws);
  }

  unregisterConnection(subdomain: string): void {
    this.connections.delete(subdomain);

    // Reject all pending requests for this subdomain
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.subdomain === subdomain) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Tunnel disconnected"));
        this.pendingRequests.delete(requestId);
      }
    }
  }

  getConnection(subdomain: string): ServerWebSocket<unknown> | undefined {
    return this.connections.get(subdomain);
  }

  hasConnection(subdomain: string): boolean {
    return this.connections.has(subdomain);
  }

  createPendingRequest(subdomain: string): string {
    const requestId = crypto.randomUUID();
    return requestId;
  }

  waitForResponse(requestId: string, subdomain: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(requestId, {
        subdomain,
        resolve,
        reject,
        timeout,
      });
    });
  }

  hasPendingRequest(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  resolvePendingRequest(requestId: string, response: HttpResponse): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    pending.resolve(response);
    this.pendingRequests.delete(requestId);
    return true;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/server/lib/tunnel-manager.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/server/lib/tunnel-manager.ts packages/server/lib/tunnel-manager.test.ts
git commit -m "feat(server): add tunnel manager for WebSocket connections"
```

---

## Task 7: Server - Main Entry Point

**Files:**
- Modify: `packages/server/index.ts`

**Step 1: Implement server with HTTP routing and WebSocket**

```typescript
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
```

**Step 2: Test manually**

Run: `bun run packages/server/index.ts`
Expected: Server starts on port 3000

**Step 3: Commit**

```bash
git add packages/server/index.ts
git commit -m "feat(server): implement main server with HTTP routing and WebSocket"
```

---

## Task 8: Client - Config Loader

**Files:**
- Create: `packages/client/lib/config.ts`
- Create: `packages/client/lib/config.test.ts`

**Step 1: Write failing test**

```typescript
// packages/client/lib/config.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type TunnelConfig } from "./config";
import { unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("Config", () => {
  const testDir = join(import.meta.dir, ".test-config");
  const testConfigPath = join(testDir, "config.json");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {}
  });

  test("loadConfig reads from file", async () => {
    const config: TunnelConfig = {
      server: "wss://tunnel.example.com/tunnel",
      token: "test-token-123",
    };
    await Bun.write(testConfigPath, JSON.stringify(config));

    const loaded = await loadConfig(testConfigPath);
    expect(loaded.server).toBe("wss://tunnel.example.com/tunnel");
    expect(loaded.token).toBe("test-token-123");
  });

  test("loadConfig uses env vars as override", async () => {
    const config: TunnelConfig = {
      server: "wss://tunnel.example.com/tunnel",
      token: "file-token",
    };
    await Bun.write(testConfigPath, JSON.stringify(config));

    process.env.TUNNEL_TOKEN = "env-token";
    const loaded = await loadConfig(testConfigPath);
    expect(loaded.token).toBe("env-token");
    delete process.env.TUNNEL_TOKEN;
  });

  test("loadConfig throws if no config found", async () => {
    expect(loadConfig("/nonexistent/path")).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/config.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// packages/client/lib/config.ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface TunnelConfig {
  server: string;
  token: string;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".tunnel", "config.json");

export async function loadConfig(configPath?: string): Promise<TunnelConfig> {
  const path = configPath || DEFAULT_CONFIG_PATH;

  let fileConfig: Partial<TunnelConfig> = {};

  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      fileConfig = await file.json();
    }
  } catch {
    // File doesn't exist or is invalid
  }

  const config: TunnelConfig = {
    server: process.env.TUNNEL_SERVER || fileConfig.server || "",
    token: process.env.TUNNEL_TOKEN || fileConfig.token || "",
  };

  if (!config.server) {
    throw new Error("Missing server URL. Set TUNNEL_SERVER env or add to config file.");
  }

  if (!config.token) {
    throw new Error("Missing token. Set TUNNEL_TOKEN env or add to config file.");
  }

  return config;
}

export async function saveConfig(config: TunnelConfig, configPath?: string): Promise<void> {
  const path = configPath || DEFAULT_CONFIG_PATH;
  const dir = join(path, "..");

  await Bun.$`mkdir -p ${dir}`;
  await Bun.write(path, JSON.stringify(config, null, 2));
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/config.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add packages/client/lib/config.ts packages/client/lib/config.test.ts
git commit -m "feat(client): add config loader with env var support"
```

---

## Task 9: Client - HTTP Proxy

**Files:**
- Create: `packages/client/lib/http-proxy.ts`
- Create: `packages/client/lib/http-proxy.test.ts`

**Step 1: Write failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/http-proxy.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/http-proxy.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add packages/client/lib/http-proxy.ts packages/client/lib/http-proxy.test.ts
git commit -m "feat(client): add HTTP proxy for forwarding requests to localhost"
```

---

## Task 10: Client - WebSocket Client

**Files:**
- Create: `packages/client/lib/ws-client.ts`

**Step 1: Write implementation**

```typescript
// packages/client/lib/ws-client.ts
import { proxyRequest } from "./http-proxy";

export interface TunnelClientOptions {
  serverUrl: string;
  token: string;
  localHost: string;
  localPort: number;
  onConnected?: (url: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRequest?: (method: string, path: string) => void;
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private options: TunnelClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private shouldReconnect = true;

  constructor(options: TunnelClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.serverUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        // Send auth message
        this.ws?.send(JSON.stringify({
          type: "auth",
          token: this.options.token,
        }));
      };

      this.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === "auth_ok") {
          const url = msg.url as string;
          this.options.onConnected?.(url);
          resolve();
        }

        if (msg.type === "auth_error") {
          const error = new Error(msg.message as string);
          this.options.onError?.(error);
          this.shouldReconnect = false;
          reject(error);
        }

        if (msg.type === "request") {
          await this.handleRequest(msg);
        }
      };

      this.ws.onclose = () => {
        this.options.onDisconnected?.();
        if (this.shouldReconnect) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (event) => {
        this.options.onError?.(new Error("WebSocket error"));
      };
    });
  }

  private async handleRequest(msg: ServerMessage): Promise<void> {
    const requestId = msg.requestId as string;
    const method = msg.method as string;
    const path = msg.path as string;
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string;

    this.options.onRequest?.(method, path);

    const response = await proxyRequest({
      host: this.options.localHost,
      port: this.options.localPort,
      method,
      path,
      headers,
      body,
    });

    this.ws?.send(JSON.stringify({
      type: "response",
      requestId,
      status: response.status,
      headers: response.headers,
      body: response.body,
    }));
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.options.onError?.(new Error("Max reconnection attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnection will be attempted on close
      });
    }, delay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
```

**Step 2: Commit**

```bash
git add packages/client/lib/ws-client.ts
git commit -m "feat(client): add WebSocket client with auto-reconnect"
```

---

## Task 11: Client - CLI Entry Point

**Files:**
- Modify: `packages/client/index.ts`

**Step 1: Implement CLI**

```typescript
#!/usr/bin/env bun
// packages/client/index.ts
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config";
import { TunnelClient } from "./lib/ws-client";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "3000" },
    host: { type: "string", short: "h", default: "localhost" },
    server: { type: "string", short: "s" },
    token: { type: "string", short: "t" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Usage: tunnel [options]

Options:
  -p, --port <port>     Local port to forward (default: 3000)
  -h, --host <host>     Local host to forward (default: localhost)
  -s, --server <url>    Server WebSocket URL (or set TUNNEL_SERVER)
  -t, --token <token>   Auth token (or set TUNNEL_TOKEN)
  --help                Show this help message
`);
  process.exit(0);
}

async function main() {
  const localPort = Number(values.port);
  const localHost = values.host || "localhost";

  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    console.error("Invalid port number");
    process.exit(1);
  }

  // Override env vars if CLI args provided
  if (values.server) process.env.TUNNEL_SERVER = values.server;
  if (values.token) process.env.TUNNEL_TOKEN = values.token;

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error(`Config error: ${(error as Error).message}`);
    console.error("\nCreate ~/.tunnel/config.json with:");
    console.error(JSON.stringify({ server: "wss://your-server/tunnel", token: "your-token" }, null, 2));
    process.exit(1);
  }

  console.log(`Connecting to ${config.server}...`);

  const client = new TunnelClient({
    serverUrl: config.server,
    token: config.token,
    localHost,
    localPort,
    onConnected: (url) => {
      console.log(`\n✓ Tunnel active: ${url}`);
      console.log(`  → forwarding to ${localHost}:${localPort}\n`);
    },
    onDisconnected: () => {
      console.log("\n⚠ Disconnected, attempting to reconnect...");
    },
    onError: (error) => {
      console.error(`\n✗ Error: ${error.message}`);
    },
    onRequest: (method, path) => {
      const timestamp = new Date().toISOString().slice(11, 19);
      console.log(`[${timestamp}] ${method} ${path}`);
    },
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    client.disconnect();
    process.exit(0);
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`Failed to connect: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
```

**Step 2: Test manually**

First terminal: `bun run packages/server/index.ts`
Second terminal: `TUNNEL_SERVER=ws://localhost:3000/tunnel TUNNEL_TOKEN=<token> bun run packages/client/index.ts --port 8080`

**Step 3: Commit**

```bash
git add packages/client/index.ts
git commit -m "feat(client): implement CLI with argument parsing"
```

---

## Task 12: Integration Test

**Files:**
- Create: `packages/server/integration.test.ts`

**Step 1: Write integration test**

```typescript
// packages/server/integration.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { initDb, createToken } from "./lib/db";

describe("Integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let localServer: ReturnType<typeof Bun.serve>;
  let token: string;
  let db: ReturnType<typeof initDb>;

  beforeAll(async () => {
    // Create test database
    db = initDb(":memory:");
    token = createToken(db);

    // Start local server (simulates user's app)
    localServer = Bun.serve({
      port: 9998,
      fetch() {
        return new Response("Hello from local!");
      },
    });

    // Note: Full integration test would require Redis
    // This is a simplified test of the token flow
  });

  afterAll(() => {
    localServer?.stop();
    db?.close();
  });

  test("token is created and validated", () => {
    const { validateToken } = require("./lib/db");
    const result = validateToken(db, token);
    expect(result).not.toBeNull();
    expect(result.id).toBeGreaterThan(0);
  });

  test("invalid token returns null", () => {
    const { validateToken } = require("./lib/db");
    const result = validateToken(db, "invalid-token");
    expect(result).toBeNull();
  });
});
```

**Step 2: Run integration test**

Run: `bun test packages/server/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/integration.test.ts
git commit -m "test(server): add integration tests for token flow"
```

---

## Task 13: Final Cleanup and Documentation

**Files:**
- Modify: `README.md`

**Step 1: Update README**

```markdown
# local-to-pub

Self-hosted tunnel server for exposing localhost to the internet.

## Quick Start

### Server (on VPS)

```bash
cd packages/server
bun install
bun run start
```

Environment variables:
- `PORT` - Server port (default: 3000)
- `BASE_DOMAIN` - Your tunnel domain (e.g., tunnel.example.com)
- `REDIS_URL` - Redis connection URL

### Client (on local machine)

```bash
cd packages/client
bun install

# Create config
mkdir -p ~/.tunnel
echo '{"server": "wss://tunnel.example.com/tunnel", "token": "your-token"}' > ~/.tunnel/config.json

# Start tunnel
bun run start --port 3000
```

## Generate Token

```bash
curl -X POST http://your-server/api/tokens
```

## Architecture

See [docs/plans/2026-01-02-tunnel-design.md](docs/plans/2026-01-02-tunnel-design.md) for full design.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with quick start guide"
```

---

## Summary

**Total Tasks:** 13

**Files Created:**
- `packages/server/index.ts`
- `packages/server/lib/db.ts`
- `packages/server/lib/redis.ts`
- `packages/server/lib/subdomain.ts`
- `packages/server/lib/protocol.ts`
- `packages/server/lib/tunnel-manager.ts`
- `packages/client/index.ts`
- `packages/client/lib/config.ts`
- `packages/client/lib/ws-client.ts`
- `packages/client/lib/http-proxy.ts`

**Testing Commands:**
```bash
# Run all tests
bun test

# Run server tests
bun test packages/server

# Run client tests
bun test packages/client
```
