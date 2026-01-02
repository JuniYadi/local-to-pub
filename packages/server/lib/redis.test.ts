// packages/server/lib/redis.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TunnelStore, type TunnelInfo } from "./redis";

describe("TunnelStore", () => {
  let store: TunnelStore;

  beforeEach(async () => {
    store = new TunnelStore(Bun.env.REDIS_URL || "redis://localhost:6379");
    await store.connect();
    // Clean up test keys
    await store.clear("test-");
  });

  afterEach(async () => {
    await store.clear("test-");
    await store.disconnect();
  });

  test("register and get tunnel", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    await store.register("test-abc123", info);
    const result = await store.get("test-abc123");

    expect(result).not.toBeNull();
    expect(result?.tokenId).toBe(1);
    expect(result?.localPort).toBe(3000);
  });

  test("unregister removes tunnel", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    await store.register("test-xyz789", info);
    await store.unregister("test-xyz789");
    const result = await store.get("test-xyz789");

    expect(result).toBeNull();
  });

  test("exists returns correct status", async () => {
    const info: TunnelInfo = {
      tokenId: 1,
      connectedAt: Date.now(),
      localPort: 3000,
    };

    expect(await store.exists("test-notexist")).toBe(false);
    await store.register("test-exists", info);
    expect(await store.exists("test-exists")).toBe(true);
  });
});
