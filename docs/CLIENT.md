# Client Usage Guide

This guide explains how to install and use the `local-to-pub` client to expose your local services to the internet.

## Installation

### Option 1: Using the Binary (Recommended)

1.  Download the `client-bin` file from your server or build it locally.
2.  Make it executable:
    ```bash
    chmod +x client-bin
    ```
3.  (Optional) Move it to your path:
    ```bash
    sudo mv client-bin /usr/local/bin/tunnel
    ```

### Option 2: Using Docker

You can run the client directly using Docker without installing anything.

```bash
docker run --network host local-to-pub-client [options]
```

## Quick Start

The simplest way to start a tunnel is to provide your server URL and token via flags:

```bash
tunnel --server wss://your-domain.com/tunnel \
       --token "your-auth-token" \
       --port 3000
```

This will expose your local service running on port `3000` to a random subdomain on your server.

## Configuration

You can configure the client using command-line arguments, environment variables, or a configuration file.

### Command Line Arguments

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `3000` | Local port to forward |
| `--host` | `-h` | `localhost` | Local host to forward to |
| `--server` | `-s` | - | Server WebSocket URL |
| `--token` | `-t` | - | Authentication token |
| `--help` | | - | Show help message |

### Environment Variables

You can set these variables to avoid typing them every time:

```bash
export TUNNEL_SERVER="wss://your-domain.com/tunnel"
export TUNNEL_TOKEN="your-auth-token"
```

Then you can just run:
```bash
tunnel --port 8080
```

### Configuration File (Persistent)

Create a file at `~/.tunnel/config.json` to store your defaults:

```json
{
  "server": "wss://your-domain.com/tunnel",
  "token": "your-auth-token"
}
```

Now you can simply run:
```bash
tunnel -p 8080
```

## Troubleshooting

### Connection Refused
If you see "Connection refused" for the local service:
1.  Ensure your local service is actually running (`curl localhost:3000`).
2.  Check if it's listening on `localhost` or `127.0.0.1`. If it's listening on `::1` (IPv6), you might need to specify `--host "::1"`.

### Authentication Error
If the server rejects your connection:
1.  Verify your token is correct.
2.  Ensure you are using `wss://` (secure) if the server has SSL configured, or `ws://` if not.
