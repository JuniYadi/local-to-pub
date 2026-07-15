# Source Map

## Repository Root

```
/install.sh                        # One-line install script (detects OS/arch, downloads release)
/package.json                      # Monorepo root (bun workspaces: packages/*)
/tsconfig.json                     # Shared TypeScript config (strict, ESNext, bundler mode)
/eslint.config.js                  # ESLint flat config (TypeScript + JS recommended)
/bun.lock                          # Bun lockfile
/docker-compose.yml                # Server + Redis stack
/Dockerfile                        # Server binary container
/Dockerfile.client                 # Client binary container
/Dockerfile.caddy                  # Custom Caddy with Cloudflare DNS plugin
/Caddyfile.example                 # Caddy config with Cloudflare wildcard TLS
/.github/workflows/ci.yml          # PR/push CI: bun test + lint
/.github/workflows/release.yml     # Tag-based release: build matrix, upload artifacts
/.github/workflows/openwiki-update.yml  # Scheduled OpenWiki doc refresh
/docs/                             # User-facing documentation
  CLIENT.md                        # Client usage (install, config, CLI flags, troubleshooting)
  INSTALL.md                       # Ubuntu server install from source (Bun + Caddy + Cloudflare)
  download.md                      # Per-platform binary download instructions
  superpowers/
    plans/                         # Implementation plans (redirect hardening, self-upgrade)
    specs/                         # Design specs (self-upgrade)
/scripts/
  build-client.sh                  # Compile client to standalone binary
  build-server.sh                  # Embed frontend + compile server to standalone binary
  embed-frontend.ts                # Build TSX → JS/CSS → hex → embedded-frontend.ts
  package.sh                       # Create .tar.gz release artifacts + checksums
  compose-release-notes.ts         # Generate GitHub release notes
  release-workflow.test.ts         # Tests for release notes script
```

## Package Structure

### `packages/client/` — Tunnel Client

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.ts` | ~110 | CLI entrypoint: arg parsing, config load, start tunnel |
| `lib/config.ts` | ~48 | Load/save `~/.tunnel/config.json` |
| `lib/version.ts` | ~22 | Version resolution (compile-time define → package.json) |
| `lib/ws-client.ts` | ~280 | WebSocket tunnel client: connect, auth, request forwarding, reconnect, heartbeat |
| `lib/http-proxy.ts` | ~143 | HTTP request proxy: fetch localhost, header filtering, redirect rewriting |
| `lib/http-proxy.test.ts` | ~240 | Tests for proxy request, redirect rewriting (i18n paths, X-Forwarded-*) |
| `lib/ws-client.test.ts` | ~140 | Tests for WS client: message handling, reconnect, abort signal |
| `lib/upgrade.ts` | ~180 | Self-upgrade: detect OS/arch, download release, replace binary |
| `lib/upgrade.test.ts` | ~105 | Tests for upgrade flow (detect config, binary detection, version parse) |
| `lib/config.test.ts` | ~45 | Tests for config load/save |

### `packages/server/` — Tunnel Server

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.ts` | ~1000 | Main server: HTTP routes, WebSocket handler, admin API, keepalive, cleanup |
| `index.html` | ~12 | Admin frontend HTML shell |
| `frontend.tsx` | ~600 | React admin dashboard: login, tokens, connections, traffic inspector |
| `styles.css` | ~250 | Admin dashboard dark theme CSS |
| `lib/protocol.ts` | ~100 | WebSocket message types and parsers |
| `lib/tunnel-manager.ts` | ~200 | Tunnel state machine: register/unregister, pending requests, browser WS, close |
| `lib/tunnel-manager.test.ts` | ~180 | Tests for tunnel manager operations |
| `lib/redis.ts` | ~73 | Redis TunnelStore: register/unregister/get/exists/clear |
| `lib/redis.test.ts` | ~45 | Tests for Redis store |
| `lib/db.ts` | ~158 | SQLite database: init, token CRUD, connection history |
| `lib/db.test.ts` | ~30 | Tests for DB operations |
| `lib/subdomain.ts` | ~33 | Subdomain generation (random 6-char), validation, extraction |
| `lib/subdomain.test.ts` | ~30 | Tests for subdomain utilities |
| `lib/embedded-frontend.ts` | ~1 file | Auto-generated hex-encoded JS/CSS (committed) |
| `integration.test.ts` | ~42 | Integration test: token create/validate with in-memory DB |

## Key Relationships

```
Client (bun --compile)         Server (bun --compile)
       │                              │
       │                              ├── index.ts (HTTP/WS handler)
       ├── index.ts (CLI)             ├── lib/protocol.ts (shared message types)
       ├── lib/ws-client.ts           ├── lib/tunnel-manager.ts (connection state)
       │         │                    ├── lib/redis.ts (active tunnel store)
       │         ├── lib/             ├── lib/db.ts (SQLite: tokens + history)
       │         │  http-proxy.ts     ├── lib/subdomain.ts
       │         │  config.ts         ├── lib/embedded-frontend.ts
       │         │  version.ts        ├── frontend.tsx (React admin UI)
       │         │  upgrade.ts        └── styles.css
       │         │
       └── lib/ws-client.ts ◄──── WebSocket (JSON messages) ────┤
```

## Deployable Artifacts

The release matrix produces six binaries:

| Binary | Platform | Architecture |
|--------|----------|-------------|
| `local-to-pub-client-linux-amd64` | Linux | x86_64 |
| `local-to-pub-client-linux-arm64` | Linux | ARM64 |
| `local-to-pub-client-darwin-amd64` | macOS | Intel |
| `local-to-pub-client-darwin-arm64` | macOS | Apple Silicon |
| `local-to-pub-server-linux-amd64` | Linux | x86_64 |
| `local-to-pub-server-linux-arm64` | Linux | ARM64 |

The server binary embeds the React admin dashboard. The client binary does not embed the frontend.
