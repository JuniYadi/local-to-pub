// packages/server/lib/db.ts
import { Database } from "bun:sqlite";

export type TokenDb = Database;

export interface TokenRecord {
  id: number;
  token_hash: string;
  subdomain: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function initDb(path: string = "tunnel.db"): TokenDb {
  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      subdomain TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME
    )
  `);

  // Migration: add subdomain column if it doesn't exist
  try {
    db.query("SELECT subdomain FROM tokens LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE tokens ADD COLUMN subdomain TEXT");
    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_subdomain ON tokens(subdomain)");
    } catch {
      // Index may already exist
    }
  }

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

export function listTokens(db: TokenDb): TokenRecord[] {
  return db
    .query("SELECT id, token_hash, subdomain, created_at, last_used_at FROM tokens ORDER BY id DESC")
    .all() as TokenRecord[];
}

/**
 * Updates or sets the persistent subdomain for a specific token.
 * @param db The database instance
 * @param id The token ID
 * @param subdomain The subdomain to reserve (or null to clear)
 * @returns boolean indicating success
 */
export function updateSubdomain(db: TokenDb, id: number, subdomain: string | null): boolean {
  try {
    const result = db
      .query("UPDATE tokens SET subdomain = ? WHERE id = ?")
      .run(subdomain, id);
    return (result?.changes ?? 0) > 0;
  } catch {
    // Likely a UNIQUE constraint violation if the subdomain is already taken
    return false;
  }
}

export function deleteToken(db: TokenDb, id: number): number {
  const result = db.query("DELETE FROM tokens WHERE id = ?").run(id);
  return result?.changes ?? 0;
}

// Connection history tracking
export interface ConnectionRecord {
  id: number;
  subdomain: string;
  token_id: number;
  connected_at: number;
  disconnected_at: number | null;
}

export function initConnectionHistory(db: TokenDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subdomain TEXT NOT NULL,
      token_id INTEGER NOT NULL,
      connected_at INTEGER NOT NULL,
      disconnected_at INTEGER,
      FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_history_subdomain ON connection_history(subdomain)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_history_live ON connection_history(disconnected_at) WHERE disconnected_at IS NULL`);
}

export function recordConnection(db: TokenDb, subdomain: string, tokenId: number): number {
  const result = db.query(
    "INSERT INTO connection_history (subdomain, token_id, connected_at, disconnected_at) VALUES (?, ?, ?, NULL)"
  ).run(subdomain, tokenId, Date.now());
  return result.lastInsertRowId as number;
}

export function recordDisconnection(db: TokenDb, subdomain: string): void {
  db.query(
    "UPDATE connection_history SET disconnected_at = ? WHERE subdomain = ? AND disconnected_at IS NULL"
  ).run(Date.now(), subdomain);
}

export function getLiveConnections(db: TokenDb): ConnectionRecord[] {
  return db.query(
    "SELECT * FROM connection_history WHERE disconnected_at IS NULL ORDER BY connected_at DESC"
  ).all() as ConnectionRecord[];
}

export function getPastConnections(db: TokenDb, limit: number = 100): ConnectionRecord[] {
  return db.query(
    "SELECT * FROM connection_history WHERE disconnected_at IS NOT NULL ORDER BY disconnected_at DESC LIMIT ?"
  ).all(limit) as ConnectionRecord[];
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
