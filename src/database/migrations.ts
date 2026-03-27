import { getDatabase } from "./connection";

export function runMigrations(): void {
  const db = getDatabase();

  console.log("Running database migrations...");

  // Users table
  db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active BOOLEAN DEFAULT 1
        )
    `);

  // Ensure display_name column exists for older databases
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasDisplayName = columns.some(
    (col: any) => col.name === "display_name",
  );
  if (!hasDisplayName) {
    db.exec(`
          ALTER TABLE users
          ADD COLUMN display_name TEXT
      `);
  }

  // Backfill missing display names to match username
  db.exec(`
        UPDATE users
        SET display_name = username
        WHERE display_name IS NULL OR display_name = ''
    `);

  // Player stats table
  db.exec(`
        CREATE TABLE IF NOT EXISTS player_stats (
            user_id INTEGER PRIMARY KEY,
            kills INTEGER DEFAULT 0,
            deaths INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            playtime_seconds INTEGER DEFAULT 0,
            matches_played INTEGER DEFAULT 0,
            last_match DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

  // Rooms table
  db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            host_user_id INTEGER NOT NULL,
            host_username TEXT NOT NULL,
            gamemode TEXT NOT NULL,
            map_name TEXT,
            max_players INTEGER DEFAULT 8,
            current_players INTEGER DEFAULT 0,
            is_public BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            inactive_since DATETIME,
            FOREIGN KEY (host_user_id) REFERENCES users(id)
        )
    `);

  // Add inactive_since column to existing rooms table
  const roomColumns = db.prepare("PRAGMA table_info(rooms)").all();
  const hasInactiveSince = roomColumns.some(
    (col: any) => col.name === "inactive_since",
  );
  if (!hasInactiveSince) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN inactive_since DATETIME
    `);
    console.log("✅ Added inactive_since column to rooms table");
  }

  // Player sessions table - tracks real-time WebSocket connections
  db.exec(`
        CREATE TABLE IF NOT EXISTS player_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            room_id TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, room_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    `);

  // Keep only the newest session row per user, then enforce one active room per user.
  db.exec(`
      DELETE FROM player_sessions
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM player_sessions
        GROUP BY user_id
      )
    `);
  db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_player_sessions_unique_user
      ON player_sessions(user_id)
    `);

  // Match history table
  db.exec(`
        CREATE TABLE IF NOT EXISTS match_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            gamemode TEXT NOT NULL,
            winner_user_id INTEGER,
            started_at DATETIME,
            ended_at DATETIME,
            duration_seconds INTEGER
        )
    `);

  // Worlds table
  db.exec(`
        CREATE TABLE IF NOT EXISTS worlds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(255) NOT NULL,
            featured BOOLEAN NOT NULL DEFAULT 0,
            date DATE NOT NULL,
            downloads INTEGER NOT NULL DEFAULT 0 CHECK (downloads >= 0),
            version VARCHAR(64) NOT NULL,
            author VARCHAR(255) NOT NULL,
            image TEXT NOT NULL,
            tbw TEXT NOT NULL,
            reports INTEGER NOT NULL DEFAULT 0 CHECK (reports >= 0),
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

  // Create indexes for better query performance
  db.exec(`
        CREATE INDEX IF NOT EXISTS idx_rooms_gamemode ON rooms(gamemode);
        CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);
        CREATE INDEX IF NOT EXISTS idx_rooms_is_public ON rooms(is_public);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_worlds_featured ON worlds(featured);
        CREATE INDEX IF NOT EXISTS idx_worlds_author ON worlds(author);
        CREATE INDEX IF NOT EXISTS idx_worlds_downloads ON worlds(downloads);
    `);

  console.log("Database migrations completed successfully");
}
