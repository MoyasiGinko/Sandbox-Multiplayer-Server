import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Create database directory if it doesn't exist
  const dbDir = path.join(__dirname, "../../database");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, "tinybox.db");
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
