# local-to-pub

Self-hosted tunnel server for exposing localhost to the internet. A simple alternative to ngrok with full domain control.

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

## CLI Options

```
Usage: tunnel [options]

Options:
  -p, --port <port>     Local port to forward (default: 3000)
  -h, --host <host>     Local host to forward (default: localhost)
  -s, --server <url>    Server WebSocket URL (or set TUNNEL_SERVER)
  -t, --token <token>   Auth token (or set TUNNEL_TOKEN)
  --help                Show this help message
```

## Architecture

See [docs/plans/2026-01-02-tunnel-design.md](docs/plans/2026-01-02-tunnel-design.md) for full design.

## Development

```bash
# Run all tests
bun test

# Run server tests
bun test packages/server

# Run client tests
bun test packages/client

# Start server in dev mode
bun run dev:server

# Start client in dev mode
bun run dev:client
```

## License

MIT
