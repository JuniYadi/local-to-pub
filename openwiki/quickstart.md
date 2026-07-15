# local-to-pub — OpenWiki Quickstart

> **100% Self-hosted tunnel server** — Expose localhost to the internet. No limits, no third-party data, no bandwidth restrictions.

local-to-pub is a self-hosted alternative to ngrok. You run the server on your VPS and a lightweight client on your local machine. The client establishes a WebSocket tunnel to the server, which proxies public HTTP/WS requests to your local service.

## Why local-to-pub?

| Feature | ngrok (Free) | local-to-pub |
|---------|-------------|--------------|
| Subdomains | 1 | Unlimited |
| Bandwidth | 1 GB/mo | Unlimited |
| Custom domains | Paid | Free |
| Self-hosted | No | Yes |
| Traffic inspector | Paid | Free |

## Quick Setup

### 1. Server (VPS)

```bash
curl -s https://raw.githubusercontent.com/JuniYadi/local-to-pub/refs/heads/main/install.sh | bash -s -- --server
```

Set required environment variables:

```bash
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="your-password"
export ADMIN_SESSION_SECRET="random-secret"
export BASE_DOMAIN="tunnel.example.com"
```

### 2. Client (Local)

```bash
curl -s https://raw.githubusercontent.com/JuniYadi/local-to-pub/refs/heads/main/install.sh | bash -s -- --client
```

Create a config file at `~/.tunnel/config.json`:

```json
{
  "server": "wss://tunnel.example.com/tunnel",
  "token": "YOUR_GENERATED_TOKEN"
}
```

Start a tunnel:

```bash
ltp --port 3000
```

Visit `https://<random>.tunnel.example.com` to see your local app.

### 3. Get a Token

Access your server's dashboard at `http://<BASE_DOMAIN>`, log in with admin credentials, and click **"Generate New Token"**.

## Documentation Sections

| Section | Description |
|---------|-------------|
| [Architecture Overview](architecture/overview.md) | System design, components, Bun runtime, protocol |
| [Source Map](source-map.md) | File tree, package structure, key files |
| [Tunnel Workflow](workflows/tunnel-flow.md) | Connection lifecycle, HTTP/WS forwarding, redirect rewriting |
| [Admin Dashboard](workflows/admin.md) | Session auth, token management, traffic inspector, force disconnect |
| [Operations / Runbook](operations/runbook.md) | Environment configs, Docker, Caddy, building, health checks |
| [Testing Guide](testing/test-guide.md) | Test inventory, how to run, Redis requirements |

## Repository at a Glance

- **Runtime**: Bun (TypeScript)
- **Build**: `bun build --compile` produces standalone binaries
- **Database**: SQLite (via `bun:sqlite`) for token storage + connection history
- **Cache**: Redis (via `Bun.redis`) for active tunnel registry
- **Frontend**: React/TSX bundled at build time, embedded as hex in binary
- **Auth**: SHA-256 token hashing + custom session tokens (HMAC-SHA256)
- **Protocol**: JSON messages over WebSocket (ping/pong keepalive)
- **Release**: GitHub Actions with matrix builds for linux/darwin × amd64/arm64

## Key Git History Insights

- **v0.0.6** (HEAD): Configurable tunnel timeouts, fix request-send race, abort on socket close
- **~v0.0.5**: WebSocket hangup recovery with heartbeat, reconnect, timeout
- **~v0.0.4**: Admin force-disconnect, Disconnect All, ping/pong keepalive, inactivity sweep
- **~v0.0.3**: Redirect hardening (Location rewrite for auth redirects), self-upgrade capability
- **~v0.0.2**: WebSocket forwarding multiplexing, connection ID tracking
- **Early**: Initial tunnel proxy, admin dashboard, token CRUD, subdomain management
