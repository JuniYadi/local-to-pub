# Local-to-Pub Tunnel Design

A self-hosted alternative to ngrok/Cloudflare Tunnel with full domain control.

## Overview

**Problem:** ngrok limits free users to 1 static subdomain. We want unlimited subdomains on our own domain.

**Solution:** Self-hosted tunnel server on VPS with WebSocket-based forwarding.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Relay location | Own VPS | Full control, no third-party limits |
| Use case | Web development (HTTP only) | Simpler scope, covers 90% of needs |
| Subdomain mode | Auto-generated | Quick dev use; custom domains later |
| Connection method | WebSocket | Bun native, works through firewalls |
| Authentication | Token-based | Simple, easy to rotate |
| Persistent storage | SQLite | Bun native `bun:sqlite` |
| Active tunnels | Redis | Fast lookup, survives restarts, Bun native `Bun.redis` |
| TLS | Wildcard certificate | Pre-generated for `*.tunnel.yourdomain.com` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR VPS                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Tunnel Server                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │ HTTP Router │  │  WebSocket  │  │  SQLite + Redis │  │   │
│  │  │ (incoming)  │──│   Manager   │──│  (tokens/tunnels)│  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ▲                                  │
└──────────────────────────────│──────────────────────────────────┘
                               │ WSS (persistent connection)
                               │
┌──────────────────────────────│──────────────────────────────────┐
│  LOCAL MACHINE               ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Tunnel Client                         │   │
│  │  ┌─────────────┐  ┌─────────────┐                       │   │
│  │  │  WebSocket  │──│ HTTP Proxy  │── localhost:3000      │   │
│  │  │   Client    │  │  (forward)  │                       │   │
│  │  └─────────────┘  └─────────────┘                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
local-to-pub/
├── packages/
│   ├── server/               # Runs on VPS
│   │   ├── index.ts          # Bun.serve() entry
│   │   ├── lib/
│   │   │   ├── db.ts         # SQLite: tokens
│   │   │   ├── redis.ts      # Redis: active tunnels
│   │   │   ├── tunnel-manager.ts
│   │   │   ├── http-router.ts
│   │   │   └── subdomain.ts
│   │   └── package.json
│   │
│   └── client/               # Runs on local machine
│       ├── index.ts          # CLI entry
│       ├── lib/
│       │   ├── config.ts
│       │   ├── ws-client.ts
│       │   └── http-proxy.ts
│       └── package.json
│
├── docs/
│   └── plans/
│       └── 2026-01-02-tunnel-design.md
│
└── package.json              # Workspace root
```

## Server Components

### Database Schema (SQLite)

```sql
-- Auth tokens
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);
```

### Redis Keys

```
tunnel:{subdomain} → {
  tokenId: number,
  connectedAt: timestamp,
  localPort: number
}
```

### System Routes (main domain only)

| Route | Purpose |
|-------|---------|
| `/tunnel` | WebSocket endpoint for clients |
| `/health` | Health check |
| `/api/*` | Admin API (token management) |

## Client Components

### CLI Usage

```bash
# Basic usage (forwards localhost:3000)
tunnel --port 3000

# With custom local host
tunnel --port 3000 --host 127.0.0.1
```

### Config File

Location: `~/.tunnel/config` or `TUNNEL_TOKEN` env var

```json
{
  "server": "wss://tunnel.yourdomain.com/tunnel",
  "token": "your-secret-token"
}
```

## WebSocket Protocol

### Message Types

```typescript
// Client → Server
{ type: "auth", token: "abc123" }
{ type: "response", requestId: "uuid", status: 200, headers: {...}, body: "base64..." }

// Server → Client
{ type: "auth_ok", subdomain: "x7f2k", url: "https://x7f2k.tunnel.yourdomain.com" }
{ type: "auth_error", message: "Invalid token" }
{ type: "request", requestId: "uuid", method: "GET", path: "/api/users", headers: {...}, body: "base64..." }
```

### Connection Lifecycle

```
Client                              Server
   |                                   |
   |──── WSS connect ─────────────────>|
   |──── { type: "auth", token } ─────>|
   |                                   | validate token
   |                                   | generate subdomain
   |                                   | store in Redis
   |<─── { type: "auth_ok", ... } ─────|
   |                                   |
   |        ... tunnel active ...      |
   |                                   |
   |     (public HTTP request arrives) |
   |<─── { type: "request", ... } ─────|
   | fetch localhost                   |
   |──── { type: "response", ... } ───>|
   |                                   | respond to HTTP client
```

## HTTP Routing Flow

```
┌─────────────────────────────────────────┐
│       Incoming HTTP Request             │
│  Host: x7f2k.tunnel.yourdomain.com      │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│     Extract subdomain from Host         │
│     "x7f2k"                             │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│     Lookup active tunnel in Redis       │
│     Key: tunnel:x7f2k                   │
└─────────────────┬───────────────────────┘
                  ▼
     ┌────────────┴────────────┐
     ▼                         ▼
Found tunnel              No tunnel found
     │                         │
     ▼                         ▼
Forward via WebSocket    Return 502 Bad Gateway
     │                   "Tunnel not connected"
     ▼
Wait for response (timeout 30s)
     │
     ▼
Return response to HTTP client
```

## Default Subdomain Flow

```
1. User runs: tunnel --port 3000

2. Client connects via WebSocket:
   wss://tunnel.yourdomain.com/tunnel
   { type: "auth", token: "abc123" }

3. Server generates random subdomain:
   - Generate: "x7f2k" (6 alphanumeric chars)
   - Check Redis availability
   - Store: tunnel:x7f2k → { tokenId, wsConnection, ... }

4. Server responds:
   { type: "auth_ok", subdomain: "x7f2k", url: "https://x7f2k.tunnel.yourdomain.com" }

5. Client displays:
   ✓ Tunnel active: https://x7f2k.tunnel.yourdomain.com
   → forwarding to localhost:3000

6. On disconnect:
   - Remove from Redis
   - Subdomain available again
```

### Subdomain Generation

```typescript
function generateSubdomain(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
```

## v1 Scope

### Included

- Auto-generated subdomains (`x7f2k.tunnel.yourdomain.com`)
- Token authentication
- WebSocket tunneling
- SQLite for tokens
- Redis for active tunnels
- Wildcard TLS certificate

### Future (v2+)

- Custom domains with CNAME verification
- Let's Encrypt auto-issue for custom domains
- Multiple tunnels per client
- Usage analytics
- Rate limiting

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Server | `Bun.serve()` with WebSocket |
| Database | `bun:sqlite` |
| Cache | `Bun.redis` |
| TLS | Wildcard cert (manual or Caddy) |
