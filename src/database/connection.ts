import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

function resolveDbPath(): string {
  const configured = (
    process.env.SQLITE_DB_PATH || "database/tinybox.db"
  ).trim();
  const fallback = (
    process.env.SQLITE_DB_FALLBACK_PATH || "/tmp/tinybox.db"
  ).trim();

  const preferred = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);

  try {
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    fs.accessSync(path.dirname(preferred), fs.constants.W_OK);
    return preferred;
  } catch {
    const safeFallback = path.isAbsolute(fallback)
      ? fallback
      : path.resolve(process.cwd(), fallback);
    fs.mkdirSync(path.dirname(safeFallback), { recursive: true });
    return safeFallback;
  }
}

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = resolveDbPath();
  db = new Database(dbPath, { verbose: console.log });

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  console.log(`Database connected at: ${dbPath}`);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log("Database connection closed");
  }
}
