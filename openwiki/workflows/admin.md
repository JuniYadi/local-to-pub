# Admin Dashboard

The admin dashboard is a React single-page application embedded in the server binary. It provides token management, connection monitoring, and a live traffic inspector.

## Authentication

### Session Token Format
The server uses a custom session token format (not JWT, but similar structure):

```
base64(payload).HMAC-SHA256(base64(payload) | secret)
```

Where the payload is JSON: `{ username, exp: timestamp }`.

- **Signing**: `SHA-256(payload + "|" + SESSION_SECRET)` — see `index.ts:109-115`
- **TTL**: 12 hours (`SESSION_TTL_MS`)
- **Cookie**: `admin_session`, HttpOnly, SameSite=Strict, Secure in production
- **No refresh mechanism** — re-login required after expiry

### Endpoints

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | `/api/login` | No (basic auth) | Returns session cookie |
| POST | `/api/logout` | No | Clears session cookie |
| GET | `/api/me` | Yes | Returns `{ username }` or 401 |

The server can be started **without** admin credentials. In that case, `ensureAdminConfigured()` returns an error string and all admin endpoints respond with 500.

## Token Management

### Token Storage
Tokens are stored as **SHA-256 hashes** in SQLite. The raw token is shown **once** on creation and cannot be retrieved later.

Schema in `packages/server/lib/db.ts`:
```sql
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  subdomain TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tokens` | List all tokens (with hash, subdomain, timestamps) |
| POST | `/api/tokens` | Generate new token (returns raw token once) |
| DELETE | `/api/tokens/:id` | Delete a token |
| POST | `/api/tokens/subdomain` | Set/clear persistent subdomain for a token |
| GET | `/api/subdomain-check?uri=xxx` | Check if a subdomain is available |

### Subdomain Management
- Admin can assign a persistent subdomain to any token via the dashboard
- The subdomain must be unique across all tokens
- If the subdomain is already taken, the API returns 409 Conflict
- Setting `subdomain: null` clears the persistent assignment

## Connection History

Two tables are queried to build the connection view:

| Table | Purpose |
|-------|---------|
| `connection_history` where `disconnected_at IS NULL` | Live/active connections |
| `connection_history` where `disconnected_at IS NOT NULL` | Past connections |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/connections` | Returns `{ live: [...], past: [...] }` |
| POST | `/api/connections/disconnect` | Force-disconnect a single subdomain |
| POST | `/api/connections/disconnect-all` | Disconnect all active tunnels |

### Force Disconnect Flow (git: b0a6337)
1. Admin sends `POST /api/connections/disconnect` with `{ subdomain: "xxx" }`
2. Server looks up the WebSocket in TunnelManager
3. Records disconnection in SQLite history
4. Closes the WebSocket and unregisters from Redis
5. Client automatically reconnects (with backoff) unless the token is deleted

`Disconnect All` iterates all active subdomains and repeats the same process.

## Live Traffic Inspector

An SSE (Server-Sent Events) endpoint streams tunnel request/response data:

```
GET /api/inspector/stream
```

- Requires admin session
- Returns `text/event-stream` content type
- Events: `{ type: "request" | "response", requestId, subdomain, timestamp, method, path, headers, body, status }`
- Stream closes when the HTTP connection is aborted (browser tab closed)
- Uses `EventEmitter` with `setMaxListeners(100)` for concurrent inspector sessions

The frontend's `Inspector` component subscribes via `new EventSource("/api/inspector/stream")` and renders a scrollable log.

## Frontend UI Components (in `frontend.tsx`)

| Component | Description |
|-----------|-------------|
| `App` | Root: manages auth state, routes Login vs Dashboard |
| `Login` | Username/password form |
| `Dashboard` | Main view with token table + connections + inspector tabs |
| `Inspector` | SSE-based live request/response log |
| Tokens table | List tokens, generate/delete buttons, editable subdomain |
| Connections panel | Live + past connection history with durations |
| `shortHash()` | Truncates token hash to first 12 chars + "..." |
| `formatDuration()` | Computes human-readable duration from timestamps |

## Admin Configuration

Environment variables required for admin functionality:

| Variable | Purpose |
|----------|---------|
| `ADMIN_USERNAME` | Admin login username (required for dashboard) |
| `ADMIN_PASSWORD` | Admin login password (required for dashboard) |
| `ADMIN_SESSION_SECRET` | HMAC key for session signing (required, falls back to ADMIN_PASSWORD) |
