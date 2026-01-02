// packages/server/lib/db.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, createToken, validateToken, type TokenDb } from "./db";

describe("Token Database", () => {
  let db: TokenDb;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("initDb creates tokens table", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'")
      .get();
    expect(tables).toBeTruthy();
  });

  test("createToken returns a token string", () => {
    const token = createToken(db);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  test("validateToken returns true for valid token", () => {
    const token = createToken(db);
    const result = validateToken(db, token);
    expect(result).not.toBeNull();
    expect(result?.id).toBeGreaterThan(0);
  });

  test("validateToken returns null for invalid token", () => {
    const result = validateToken(db, "invalid-token");
    expect(result).toBeNull();
  });
});
