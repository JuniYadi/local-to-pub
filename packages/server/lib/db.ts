// packages/server/lib/db.ts
import { Database } from "bun:sqlite";

export type TokenDb = Database;

export interface TokenRecord {
  id: number;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export function initDb(path: string = "tunnel.db"): TokenDb {
  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME
    )
  `);

  return db;
}

export function createToken(db: TokenDb): string {
  const token = generateSecureToken();
  const hash = hashToken(token);

  db.query("INSERT INTO tokens (token_hash) VALUES (?)").run(hash);

  return token;
}

export function validateToken(db: TokenDb, token: string): TokenRecord | null {
  const hash = hashToken(token);

  const record = db
    .query("SELECT * FROM tokens WHERE token_hash = ?")
    .get(hash) as TokenRecord | null;

  if (record) {
    db.query("UPDATE tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(record.id);
  }

  return record;
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}
