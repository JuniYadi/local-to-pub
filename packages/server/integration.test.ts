// packages/server/integration.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { initDb, createToken } from "./lib/db";

describe("Integration", () => {
  let localServer: ReturnType<typeof Bun.serve>;
  let token: string;
  let db: ReturnType<typeof initDb>;

  beforeAll(async () => {
    // Create test database
    db = initDb(":memory:");
    token = createToken(db);

    // Start local server (simulates user's app)
    localServer = Bun.serve({
      port: 9998,
      fetch() {
        return new Response("Hello from local!");
      },
    });

    // Note: Full integration test would require Redis
    // This is a simplified test of the token flow
  });

  afterAll(() => {
    localServer?.stop();
    db?.close();
  });

  test("token is created and validated", () => {
    const { validateToken } = require("./lib/db");
    const result = validateToken(db, token);
    expect(result).not.toBeNull();
    expect(result.id).toBeGreaterThan(0);
  });

  test("invalid token returns null", () => {
    const { validateToken } = require("./lib/db");
    const result = validateToken(db, "invalid-token");
    expect(result).toBeNull();
  });
});
