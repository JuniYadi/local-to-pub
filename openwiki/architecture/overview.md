# Architecture Overview

## System Architecture

```text
Internet ────► Your VPS ────────── WebSocket ────► Your Laptop
  │                 │                  │                  │
  │                 │                  │                  │
  ▼                 ▼                  ▼                  ▼
Browser         Tunnel Server      Tunnel Client     localhost:3000
Mobile          (Bun.serve)        (ws-client.ts)    (Your App)
Webhook             │                  │
                    │                  │
                    ▼                  │
                 SQLite ◄─────────────┘
               (tunnel.db)         (token auth)
                    │
                    ▼
                 Redis
              (Active Tunnels)
```

The system has two deployment sides:

1. **Server** — Runs on a public VPS, accepts incoming HTTP/WS requests, and forwards them to the connected client over WebSocket.
2. **Client** — Runs on your local machine, connects to the server via WebSocket, proxies requests to a local service.

## Components

### Server (`packages/server/index.ts`)
The entire server is a single TypeScript entrypoint (~1000 lines) that handles:
- HTTP routing (admin API, frontend, tunnel proxying, health checks)
- WebSocket upgrade and message handling (control + tunnel connections)
- Admin session management with custom HMAC-SHA256 session tokens
- Token CRUD against SQLite
- Active tunnel registration via Redis
- Live traffic inspector (SSE event stream)
- Ping/keepalive and inactivity cleanup

Built with `Bun.serve()` — no Express or Node.js HTTP.

### Client (`packages/client/index.ts`)
CLI entrypoint that:
- Parses CLI args (port, host, server, token, uri, force, etc.)
- Loads config from `~/.tunnel/config.json` or env vars
- Instantiates a `TunnelClient` and manages connection lifecycle

### TunnelManager (`packages/server/lib/tunnel-manager.ts`)
In-memory registry for:
- Active tunnel control connections (`Map<subdomain, WebSocket>`)
- Browser WebSocket connections for WS forwarding
- Pending HTTP requests awaiting response from client
- Timeout management per pending request

### TunnelStore (`packages/server/lib/redis.ts`)
Redis-backed store for active tunnel information:
- `tunnel:<subdomain>` → `{ tokenId, connectedAt, localPort }`
- Used for subdomain existence checks and fast lookup
- Also stores the subdomain mapping so admin can see live tunnels

### Database (`packages/server/lib/db.ts`)
SQLite database (`tunnel.db`) with two tables:
- **`tokens`** — Stores SHA-256 hashed tokens with optional persistent subdomain
- **`connection_history`** — Tracks connect/disconnect timestamps per tunnel

### Protocol (`packages/server/lib/protocol.ts`)
TypeScript interfaces and parsers for the WebSocket message protocol:

| Direction | Message Types |
|-----------|---------------|
| Client → Server | `auth`, `response`, `ws_ready`, `ws_data`, `ws_close`, `pong` |
| Server → Client | `auth_ok`, `auth_error`, `request`, `ws_open`, `ws_data`, `ws_close`, `ping` |

Messages are JSON-serialized. Binary bodies are base64-encoded.

### HTTP Proxy (`packages/client/lib/http-proxy.ts`)
Client-side module that:
  - Forwards HTTP requests from the server to the local service
  - Filters hop-by-hop headers
  - Rewrites `Location` headers for auth redirects (preserving subdomain)
  - Applies configurable timeout (`TUNNEL_LOCAL_REQUEST_TIMEOUT_MS`)
  - Returns response status/headers/body as base64

### WebSocket Client (`packages/client/lib/ws-client.ts`)
Client-side WebSocket handler that:
  - Connects to the server with auth
  - Handles HTTP request forwarding
  - Manages local WebSocket connections (for WS tunneling)
  - Implements reconnect with exponential backoff
  - Heartbeat watchdog for detecting hung connections
  - Server-side abort signal forwarding

### Admin Frontend (`packages/server/frontend.tsx`)
React+TSX single-page application (~600 lines) with:
  - Login form
  - Token table (generate, delete, assign subdomain)
  - Connection history (live + past)
  - Live traffic inspector (SSE-based)
  - Force-disconnect and Disconnect All buttons

Frontend is **embedded directly in the server binary** at build time via `scripts/embed-frontend.ts` — no separate deployment needed.

## Bun Runtime Choices

The project exclusively uses Bun APIs — no Node.js-compatible alternatives:

| Purpose | Bun API | Why |
|---------|---------|-----|
| HTTP/WS server | `Bun.serve()` | Built-in WebSocket support, zero deps |
| SQLite | `bun:sqlite` | No `better-sqlite3` needed |
| Redis | `Bun.redis` (`RedisClient`) | No `ioredis` needed |
| File reading | `Bun.file()` | Simpler than `node:fs` |
| Shell commands | `Bun.$` | No `execa` needed |
| Crypto (SHA-256) | `Bun.CryptoHasher` | Built-in |
| Test runner | `bun test` | Drop-in Jest/Vitest replacement |

## Version Injection

Version is injected at **compile time** via `--define VERSION="'x.y.z'"`. Both build scripts use:

```bash
bun build ./packages/server/index.ts --compile --define VERSION="'${VERSION}'" --outfile server-bin
```

At runtime, code checks `typeof VERSION !== "undefined"` and falls back to `package.json` version. See `packages/client/lib/version.ts`.

## Frontend Embedding Strategy

1. `scripts/embed-frontend.ts` builds the TSX frontend with `Bun.build()` targeting browser
2. Converts JS/CSS output to hex strings
3. Generates `packages/server/lib/embedded-frontend.ts` that exports the hex strings
4. At runtime, the server checks for embedded assets first, then falls back to filesystem build

This produces a **single binary** with everything needed — no static files to deploy.
