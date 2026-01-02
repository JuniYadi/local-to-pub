// packages/client/lib/config.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type TunnelConfig } from "./config";
import { unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("Config", () => {
  const testDir = join(import.meta.dir, ".test-config");
  const testConfigPath = join(testDir, "config.json");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {}
  });

  test("loadConfig reads from file", async () => {
    const config: TunnelConfig = {
      server: "wss://tunnel.example.com/tunnel",
      token: "test-token-123",
    };
    await Bun.write(testConfigPath, JSON.stringify(config));

    const loaded = await loadConfig(testConfigPath);
    expect(loaded.server).toBe("wss://tunnel.example.com/tunnel");
    expect(loaded.token).toBe("test-token-123");
  });

  test("loadConfig uses env vars as override", async () => {
    const config: TunnelConfig = {
      server: "wss://tunnel.example.com/tunnel",
      token: "file-token",
    };
    await Bun.write(testConfigPath, JSON.stringify(config));

    process.env.TUNNEL_TOKEN = "env-token";
    const loaded = await loadConfig(testConfigPath);
    expect(loaded.token).toBe("env-token");
    delete process.env.TUNNEL_TOKEN;
  });

  test("loadConfig throws if no config found", async () => {
    expect(loadConfig("/nonexistent/path")).rejects.toThrow();
  });
});
