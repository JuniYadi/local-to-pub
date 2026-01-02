// packages/client/lib/config.ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface TunnelConfig {
  server: string;
  token: string;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".tunnel", "config.json");

export async function loadConfig(configPath?: string): Promise<TunnelConfig> {
  const path = configPath || DEFAULT_CONFIG_PATH;

  let fileConfig: Partial<TunnelConfig> = {};

  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      fileConfig = await file.json();
    }
  } catch {
    // File doesn't exist or is invalid
  }

  const config: TunnelConfig = {
    server: process.env.TUNNEL_SERVER || fileConfig.server || "",
    token: process.env.TUNNEL_TOKEN || fileConfig.token || "",
  };

  if (!config.server) {
    throw new Error("Missing server URL. Set TUNNEL_SERVER env or add to config file.");
  }

  if (!config.token) {
    throw new Error("Missing token. Set TUNNEL_TOKEN env or add to config file.");
  }

  return config;
}

export async function saveConfig(config: TunnelConfig, configPath?: string): Promise<void> {
  const path = configPath || DEFAULT_CONFIG_PATH;
  const dir = join(path, "..");

  await Bun.$`mkdir -p ${dir}`;
  await Bun.write(path, JSON.stringify(config, null, 2));
}
