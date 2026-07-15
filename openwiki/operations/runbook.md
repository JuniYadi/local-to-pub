# Operations / Runbook

## Environment Variables

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP/WS server port |
| `BASE_DOMAIN` | No | `localhost:3000` | Your tunnel domain (e.g., `tunnel.example.com`) |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection string |
| `ADMIN_USERNAME` | Yes* | — | Admin dashboard username |
| `ADMIN_PASSWORD` | Yes* | — | Admin dashboard password |
| `ADMIN_SESSION_SECRET` | Yes* | falls back to `ADMIN_PASSWORD` | HMAC key for session signing. Use a long random string. |
| `ALLOW_CUSTOM_SUBDOMAINS` | No | `true` | Allow clients to request specific subdomains via `--uri` |
| `TUNNEL_REQUEST_TIMEOUT_MS` | No | `305000` | Server waits this long for client response (must be ≥ client + 5s) |
| `NODE_ENV` | No | — | Set to `production` to enable `Secure` cookie flag and HTTPS protocol |

\* Required for admin dashboard to function. Server runs without them but admin endpoints return 500.

### Client

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TUNNEL_SERVER` | No | from `~/.tunnel/config.json` | Server WebSocket URL |
| `TUNNEL_TOKEN` | No | from `~/.tunnel/config.json` | Auth token |
| `TUNNEL_LOCAL_REQUEST_TIMEOUT_MS` | No | `300000` | Max time waiting for local service response |

### CLI Flags (Client)

```bash
local-to-pub [options]

Options:
  -p, --port <port>     Local port to forward (default: 3000)
  -h, --host <host>     Local host to forward (default: localhost)
  --host-header <host>  Override Host header (e.g. localhost:3000)
  -s, --server <url>    Server WebSocket URL (or set TUNNEL_SERVER)
  -t, --token <token>   Auth token (or set TUNNEL_TOKEN)
  -y, --uri <subdomain> Request specific subdomain (optional)
  --force               Force-take a subdomain even if already in use
  -v, --version         Show client version
  --upgrade             Upgrade to latest version
  --global              Install/upgrade to system-wide directory (/usr/local/bin)
  --help                Show this help message
```

## Client Config File

`~/.tunnel/config.json`:
```json
{
  "server": "wss://your-server.com/tunnel",
  "token": "your-auth-token"
}
```

Config file is optional. CLI flags and env vars take precedence.

## Building from Source

```bash
# Install dependencies
bun install

# Build server binary (includes embedded frontend)
bun run build:server
# Output: ./server-bin

# Build client binary
bun run build:client
# Output: ./client-bin
```

Build scripts: `scripts/build-server.sh`, `scripts/build-client.sh`

## Docker Deployment

### Server + Redis

```bash
docker compose up -d
```

Uses `docker-compose.yml` with the server binary built into a Debian slim container.

### Standalone Server Container

```bash
# Build the server binary first, then:
docker build -f Dockerfile -t local-to-pub-server .
docker run -p 3000:3000 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=securepass \
  -e ADMIN_SESSION_SECRET=randoms3cr3t \
  -e BASE_DOMAIN=tunnel.example.com \
  -e REDIS_URL=redis://redis-host:6379 \
  local-to-pub-server
```

### Standalone Client Container

```bash
docker build -f Dockerfile.client -t local-to-pub-client .
docker run --network host local-to-pub-client \
  --port 3000 \
  --server wss://your-server.com/tunnel \
  --token your-token
```

## Caddy + Cloudflare Setup

For wildcard SSL on your tunnel domain, use Caddy with the Cloudflare DNS plugin.

1. Build custom Caddy (see `Dockerfile.caddy`)
2. Configure `Caddyfile.example`:
   - Replace `your-email@example.com` and `your-domain.com`
   - Set `CLOUDFLARE_API_TOKEN` environment variable
3. Two Caddy routes:
   - **Root domain** (`your-domain.com`) → reverse proxy to localhost:3000
   - **Wildcard** (`*.your-domain.com`) → reverse proxy to localhost:3000

## Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "connections": 3,
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

Returns 200 OK if the server is running. Used for monitoring and load balancer health probes.

## Production Checklist

- [ ] Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (long, random)
- [ ] Set `BASE_DOMAIN` to your actual domain
- [ ] Set `REDIS_URL` to a persistent Redis instance (not ephemeral)
- [ ] Set `NODE_ENV=production` (enables Secure cookies, HTTPS protocol in tunnel URLs)
- [ ] Configure reverse proxy with TLS (Caddy, Nginx) for the tunnel domain
- [ ] Set wildcard DNS record (`*.tunnel.example.com → your VPS IP`)
- [ ] Configure `TUNNEL_REQUEST_TIMEOUT_MS` if clients have slow local compilation
- [ ] Verify SQLite database (`tunnel.db`) is in a persistent volume
- [ ] Configure log rotation for server stdout

## Persistence

### SQLite (`tunnel.db`)
- Tokens and connection history are stored here
- Must be on persistent storage (not ephemeral container filesystem)
- Location: current working directory of the server process
- No built-in backup mechanism — use filesystem-level backups

### Redis
- Active tunnel registrations (ephemeral — tunnels re-register on reconnect)
- Data loss is non-fatal: clients just need to reconnect
- If Redis restarts, tunnels will re-register on next auth
- Subdomain availability checks still work after Redis restart (TunnelManager in-memory state is authoritative)

## Client Configuration

### `~/.tunnel/config.json`

The client reads config from `~/.tunnel/config.json` with the following precedence (highest wins):

1. CLI flags (`--server`, `--token`)
2. Environment variables (`TUNNEL_SERVER`, `TUNNEL_TOKEN`)
3. Config file

The config file can be created manually or saved via the upgrade flow.

### Binary Locations

- **User-local** (default): `~/.local/bin/local-to-pub`
- **Global** (`--global`): `/usr/local/bin/local-to-pub`

## Known Issues and Considerations

- **WebSocket hangups**: The app-level ping/pong system recovers from hangs where TCP is alive but the app is stuck (commit 1aeb698)
- **Slow compilation time**: Set `TUNNEL_LOCAL_REQUEST_TIMEOUT_MS=600000` for Next.js cold starts, and adjust server `TUNNEL_REQUEST_TIMEOUT_MS` accordingly
- **Port conflicts**: Server defaults to port 3000; set `PORT` env var to change
- **Redis dependency**: Server won't start without Redis. Ensure Redis is available at `REDIS_URL`
- **SQLite concurrent access**: Single-process access only. Not suitable for multi-instance server deployment without moving to a shared database
