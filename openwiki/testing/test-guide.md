# Testing Guide

## Test Runner

Uses **bun test** (Bun's built-in test runner, Jest/Vitest compatible).

```bash
# Run all tests
bun test

# Run tests with watch mode
bun test --watch

# Run a specific test file
bun test packages/client/lib/http-proxy.test.ts
```

## CI Pipeline

Defined in `.github/workflows/ci.yml`:

1. Checkout + setup Bun (latest)
2. `bun install`
3. `bun test` (with Redis service at `redis://localhost:6379`)
4. `bun run lint` (ESLint)

**Note**: Redis is required for the full test suite. Tests that depend on Redis will skip or fail if Redis is unavailable.

## Test Files Inventory

### Client Tests

| Test File | Coverage | Key Scenarios |
|-----------|----------|---------------|
| `packages/client/lib/http-proxy.test.ts` (~240 lines) | HTTP proxy module | URL construction, header filtering, redirect rewriting (X-Forwarded-*, i18n paths, locale prefix), timeout handling, connection errors |
| `packages/client/lib/ws-client.test.ts` (~140 lines) | WebSocket client | Auth message flow, request/response round-trip, reconnect with backoff, abort signal propagation, message handling |
| `packages/client/lib/upgrade.test.ts` (~105 lines) | Self-upgrade | OS/arch detection, binary path resolution, config detection for upgrade paths, version parsing |
| `packages/client/lib/config.test.ts` (~45 lines) | Config loading | Missing config file, valid config load, env var override precedence |

### Server Tests

| Test File | Coverage | Key Scenarios |
|-----------|----------|---------------|
| `packages/server/lib/tunnel-manager.test.ts` (~180 lines) | Tunnel state machine | Register/unregister connections, pending request lifecycle, browser connection management, message buffering, connection cleanup |
| `packages/server/lib/db.test.ts` (~30 lines) | SQLite database | Token creation, validation (valid + invalid), list tokens |
| `packages/server/lib/redis.test.ts` (~45 lines) | Redis store | Register/get/unregister tunnel info, exists check, clear by prefix |
| `packages/server/lib/subdomain.test.ts` (~30 lines) | Subdomain utilities | Generation (length, charset), validation (format rules), extraction from host header |
| `packages/server/integration.test.ts` (~42 lines) | Integration | Token create/validate flow with in-memory SQLite, basic local server proxy simulation |

## What to Test When Changing Each Area

### Adding a new message type to the protocol
- Update `protocol.ts` interfaces and `parseClientMessage()`
- Add test cases in `ws-client.test.ts` for client-side handling
- Add test cases in `tunnel-manager.test.ts` for server-side handling
- Verify the message round-trip in `ws-client.test.ts` mock server

### Modifying tunnel auth logic
- Test in `tunnel-manager.test.ts`: registration, subdomain conflicts, reconnection
- Test in `ws-client.test.ts`: auth message format, error handling
- Integration test: `integration.test.ts` — token validation chain
- Manual test: connect client with valid/invalid token, check `--uri` and `--force` flags

### Changing redirect rewriting
- Update `http-proxy.ts` `rewriteRedirectLocation()`
- Add cases to `http-proxy.test.ts`: test Location header rewrites for:
  - X-Forwarded-* headers
  - i18n path prefixes (`/en/login`)
  - Same-host vs external redirects
  - Path suffix/prefix variations

### Modifying heartbeat/keepalive
- Test in `ws-client.test.ts`: heartbeat timeout, reconnect trigger
- Test in `tunnel-manager.test.ts`: connection lifecycle during inactivity
- Manual test: simulate network partition, verify cleanup

### Changing the admin API
- No automated API tests yet (frontend is tested manually)
- Verify with manual curl commands against `localhost:3000/api/*`
- Check session expiry, token CRUD, force disconnect flows

### Changing database schema
- Update `db.ts` migration logic (ALTER TABLE fallback)
- Update `db.test.ts` for any new query functions
- Consider backward compatibility with existing `tunnel.db` files

### Modifying upgrade flow
- Update `upgrade.test.ts` for new OS/arch targets
- Test download URL construction
- Test version comparison logic

## Testing Redis-Dependent Code

The CI workflow runs Redis as a service container. For local testing:

```bash
# Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Run tests with REDIS_URL set
REDIS_URL=redis://localhost:6379 bun test
```

The `redis.test.ts` connects to the configured `REDIS_URL` and will fail if Redis is unavailable.

## Manual Testing Flow

For end-to-end testing:

1. Start Redis: `docker run -d -p 6379:6379 redis:7-alpine`
2. Start server: `ADMIN_USERNAME=admin ADMIN_PASSWORD=pass ADMIN_SESSION_SECRET=secret bun run dev:server`
3. Create a token via admin dashboard or API
4. Start client: `TUNNEL_SERVER=ws://localhost:3000/tunnel TUNNEL_TOKEN=<token> bun run dev:client`
5. Test HTTP: `curl http://<generated-subdomain>.localhost:3000/`
6. Test admin dashboard at `http://localhost:3000/`
7. Test force disconnect via admin panel
8. Test reconnect behavior by stopping/starting the client

## Linting

```bash
bun run lint        # Check
bun run lint:fix    # Auto-fix
bun run format      # Prettier format
bun run format:check  # Check formatting
```

Uses ESLint flat config with TypeScript strict rules. Unused variables (prefixed with `_`) are allowed.
