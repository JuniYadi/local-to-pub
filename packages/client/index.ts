#!/usr/bin/env bun
// packages/client/index.ts
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config";
import { TunnelClient } from "./lib/ws-client";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "3000" },
    host: { type: "string", short: "h", default: "localhost" },
    server: { type: "string", short: "s" },
    token: { type: "string", short: "t" },
    uri: { type: "string", short: "y" },
    "host-header": { type: "string" },
    version: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});

const VERSION = "0.0.10";

if (values.version) {
  console.log(`local-to-pub v${VERSION}`);
  process.exit(0);
}

if (values.help) {
  console.log(`
Usage: tunnel [options]

Options:
  -p, --port <port>     Local port to forward (default: 3000)
  -h, --host <host>     Local host to forward (default: localhost)
  --host-header <host>  Override Host header (e.g. localhost:3000)
  -s, --server <url>    Server WebSocket URL (or set TUNNEL_SERVER)
  -t, --token <token>   Auth token (or set TUNNEL_TOKEN)
  -y, --uri <subdomain> Request specific subdomain (optional)
  --help                Show this help message
`);
  process.exit(0);
}

async function main() {
  const localPort = Number(values.port);
  const localHost = values.host || "localhost";
  const hostHeader = values["host-header"];

  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    console.error("Invalid port number");
    process.exit(1);
  }

  // Override env vars if CLI args provided
  if (values.server) process.env.TUNNEL_SERVER = values.server;
  if (values.token) process.env.TUNNEL_TOKEN = values.token;

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error(`Config error: ${(error as Error).message}`);
    console.error("\nCreate ~/.tunnel/config.json with:");
    console.error(JSON.stringify({ server: "wss://your-server/tunnel", token: "your-token" }, null, 2));
    process.exit(1);
  }

  console.log(`Connecting to ${config.server}...`);

  const client = new TunnelClient({
    serverUrl: config.server,
    token: config.token,
    localHost,
    localPort,
    hostHeader,
    requestedSubdomain: values.uri,
    onConnected: (url) => {
      console.log(`\n✓ Tunnel active: ${url}`);
      console.log(`  → forwarding to ${localHost}:${localPort}\n`);
    },
    onDisconnected: () => {
      console.log("\n⚠ Disconnected, attempting to reconnect...");
    },
    onError: (error) => {
      console.error(`\n✗ Error: ${error.message}`);
    },
    onRequest: (method, path) => {
      const timestamp = new Date().toISOString().slice(11, 19);
      console.log(`[${timestamp}] ${method} ${path}`);
    },
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    client.disconnect();
    process.exit(0);
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`Failed to connect: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
