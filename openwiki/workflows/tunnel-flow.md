# Tunnel Workflows

## 1. Connection Lifecycle

```
Client                              Server
  │                                   │
  │──── WebSocket connect ───────────►│
  │                                   │
  │──── { type: "auth", token } ────►│  ── Validate token (SHA-256 hash match)
  │                                   │
  │                                   ├── Determine subdomain:
  │                                   │   a. --uri flag (if ALLOW_CUSTOM_SUBDOMAINS)
  │                                   │   b. Persistent subdomain from token record
  │                                   │   c. Random 6-char generated (up to 10 attempts)
  │                                   │
  │                                   ├── Register in Redis: tunnel:<subdomain>
  │                                   ├── Register in TunnelManager (in-memory)
  │                                   ├── Record connection in SQLite history
  │                                   │
  │◄─── { type: "auth_ok", url } ────┤
  │                                   │
  │     [Tunnel active, proxy ready]  │
```

### Subdomain Assignment Logic

In `packages/server/index.ts` (auth handler, ~line 740-838):

1. **Client requests a specific subdomain** (`--uri`):
   - Server must have `ALLOW_CUSTOM_SUBDOMAINS=true` (default)
   - Validates format (3-20 chars, alphanumeric lowercase)
   - Checks if already in use → rejects with error
   - **Force override** (`--force`): Only works if the existing connection is dead (WebSocket not OPEN)
   - If same token reconnects to its own subdomain, old connection is closed gracefully

2. **Token has a persistent subdomain** (set via admin dashboard):
   - Same conflict resolution as above

3. **No preference**:
   - Generates random 6-char alphanumeric
   - Checks Redis for collision (up to 10 attempts)
   - If all attempts fail, returns auth_error

### Auth Validation

- Token is SHA-256 hashed on both client and server (see `packages/server/lib/db.ts` line 146-158)
- Server stores only the hash
- `validateToken()` also updates `last_used_at` timestamp

## 2. HTTP Request Forwarding

```
Browser                    Server                    Client                  Local App
  │                         │                         │                        │
  │──── HTTP GET /api ─────►│                         │                        │
  │                         │                         │                        │
  │                         ├── extractSubdomain()    │                        │
  │                         ├── tunnelManager         │                        │
  │                         │   .getConnection()      │                        │
  │                         │                         │                        │
  │                         ├── createPendingRequest  │                        │
  │                         │   (with timeout)        │                        │
  │                         │                         │                        │
  │                         │── { type:"request",     │                        │
  │                         │     requestId, method,  │                        │
  │                         │     path, headers,      │                        │
  │                         │     body (base64) } ────►│                        │
  │                         │                         │                        │
  │                         │                         ├── proxyRequest()        │
  │                         │                         │   (http-proxy.ts)      │
  │                         │                         │──── HTTP GET /api ─────►│
  │                         │                         │◄─── HTTP 200 {...} ────┤
  │                         │                         │                        │
  │                         │◄── { type:"response",   │                        │
  │                         │      requestId, status, │                        │
  │                         │      headers, body    } ─┤                        │
  │                         │                         │                        │
  │                         ├── resolve pending       │                        │
  │                         ├── emit inspector event  │                        │
  │                         │                         │                        │
  │◄──── HTTP 200 OK ───────┤                         │                        │
```

### Proxy Details (`packages/client/lib/http-proxy.ts`)

- Uses `fetch()` with `redirect: "manual"` to prevent automatic redirect following
- Filters hop-by-hop headers (host, connection, transfer-encoding, upgrade, etc.)
- Sets `Host` header correctly (either overridden or original)
- Supports abort signal propagation (server can abort client-side requests)
- Applies `TUNNEL_LOCAL_REQUEST_TIMEOUT_MS` (default 300s)

### Redirect Rewriting

Auth redirects (e.g., `/login → /en/login`) need special handling because the browser sees the tunnel URL, not the local service URL. In `rewriteRedirectLocation()`:

1. If the Location header points to the local service (same host:port) → rewrite to `forwardedProto://forwardedHost/path`
2. Preserves path prefix (e.g., `/en/login` gets prefix-rewritten correctly for i18n)

See git commits:
- `094245f` — i18n path prefix preservation
- `889827d` — X-Forwarded-* headers and initial Location rewrite
- `b436c15` — Locale prefix preservation fix

### Timeout Handling

| Layer | Timeout | Env Var | Default | Source |
|-------|---------|---------|---------|--------|
| Server waits for client response | `TUNNEL_REQUEST_TIMEOUT_MS` | Server env | 305000ms | `tunnel-manager.ts` |
| Client fetches from localhost | `TUNNEL_LOCAL_REQUEST_TIMEOUT_MS` | Client env | 300000ms | `http-proxy.ts` |

The server timeout **must** be ≥ client timeout + 5s to avoid false timeouts during slow local compilation (e.g., Next.js cold start).

### Error Responses

- Local server timed out → 504 Gateway Timeout (with body "Local server timed out")
- Connection refused → 502 Bad Gateway (with body "Failed to connect to local server")
- Tunnel not found → 502 Bad Gateway
- Server too slow → 504 Gateway Timeout + tunnel forcibly closed

## 3. WebSocket Forwarding

The server supports WebSocket tunneling through clients. When a browser makes a WebSocket connection to a tunnel subdomain:

```
Browser WebSocket             Server                          Client
  │                            │                               │
  │── ws://app.tunnel.com ────►│                               │
  │                            │                               │
  │                            ├── Upgrade to WebSocket        │
  │                            ├── Register browser conn       │
  │                            │── { type:"ws_open",           │
  │                            │     requestId, path } ───────►│
  │                            │                               │
  │                            │                               ├── Open local WS
  │                            │                               │   to localhost:port
  │                            │                               │
  │                            │◄── { type:"ws_ready",        │
  │                            │       requestId } ────────────┤
  │                            │                               │
  │                            ├── Flush buffered messages     │
  │                            │── { type:"ws_data", ... } ───►│──► Local WS
  │◄──── ws data ─────────────┤◄── { type:"ws_data", ... } ────┤◄── Local WS
  │                            │                               │
  │                            │── { type:"ws_close", ... } ──►│──► Close local WS
```

Key details:
- Browser WS messages are **buffered** until the client signals `ws_ready` (up to 100 messages)
- Data is passed through as base64-encoded binary
- The server acts as a transparent multiplexer between browser ↔ client WS connections

## 4. Keepalive and Inactivity Cleanup

The server runs two timers at 15-second intervals:

### Ping Timer
Sends `{ type: "ping" }` to every active control connection every 15s. The client must respond with `{ type: "pong" }` in its message handler. This detects **application-level** hangs where TCP is alive but the Bun event loop is stuck.

### Inactivity Sweep
Closes connections where `lastActivity` is older than 45s. `lastActivity` is updated on every message received from the client (including pong responses). WebSocket-level auto-pong from the TCP stack is intentionally **not** counted as activity — only application-level responses count.

### Client-Side Heartbeat Watchdog
The client also maintains a heartbeat timer:
- Checks every 15s if a server message arrived within 45s
- If not, closes and reconnects

### Client Reconnect
On disconnect (intentional or not), the client:
1. Sets `shouldReconnect` flag (cleared on intentional `disconnect()`)
2. Exponential backoff: 1s → 2s → 4s → ... → 30s max
3. Preserves `requestedSubdomain` and `force` flags across reconnects

## 5. Upgrade Flow

The client supports self-upgrade:

```bash
local-to-pub --upgrade
```

In `packages/client/lib/upgrade.ts`:
1. Detects current OS/arch
2. Fetches latest release tag from GitHub API
3. Compares with installed version (`--version` output)
4. Downloads matching `local-to-pub-client-{os}-{arch}-{version}.tar.gz`
5. Extracts, replaces binary (at `~/.local/bin/` or `/usr/local/bin` if `--global`)

Designed in spec: `docs/superpowers/specs/2026-06-06-self-upgrade-design.md`
