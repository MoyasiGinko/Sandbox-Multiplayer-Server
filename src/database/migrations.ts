import { getDatabase } from "./connection";

function runOneTimeHardResetIfRequested(
  db: ReturnType<typeof getDatabase>,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const shouldReset =
    (process.env.RESET_DB_ON_START ?? "true").toLowerCase() === "true";

  if (!shouldReset) {
    return;
  }

  const markerKey = "hard_reset_v2";
  const markerRow = db
    .prepare("SELECT value FROM system_meta WHERE key = ?")
    .get(markerKey) as { value: string } | undefined;

  if (markerRow?.value === "done") {
    return;
  }

  console.warn("⚠️ RESET_DB_ON_START enabled: dropping all multiplayer tables");

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS player_sessions;
    DROP TABLE IF EXISTS room_chat_messages;
    DROP TABLE IF EXISTS match_history;
    DROP TABLE IF EXISTS rooms;
    DROP TABLE IF EXISTS player_stats;
    DROP TABLE IF EXISTS worlds;
    DROP TABLE IF EXISTS users;
  `);
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.prepare(
    `
    INSERT INTO system_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(markerKey, "done");
}

export function runMigrations(): void {
  const db = getDatabase();

  console.log("Running database migrations...");

  runOneTimeHardResetIfRequested(db);

  // Rooms table
  db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            host_user_id INTEGER NOT NULL,
            host_username TEXT NOT NULL,
            gamemode TEXT NOT NULL,
            map_name TEXT,
        active_gamemode_index INTEGER,
        active_gamemode_params TEXT,
        active_gamemode_mods TEXT,
        active_gamemode_started_at_ms INTEGER,
            max_players INTEGER DEFAULT 8,
            current_players INTEGER DEFAULT 0,
            is_public BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            inactive_since DATETIME
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

  const hasActiveGamemodeIndex = roomColumns.some(
    (col: any) => col.name === "active_gamemode_index",
  );
  if (!hasActiveGamemodeIndex) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_index INTEGER
    `);
    console.log("✅ Added active_gamemode_index column to rooms table");
  }

  const hasActiveGamemodeParams = roomColumns.some(
    (col: any) => col.name === "active_gamemode_params",
  );
  if (!hasActiveGamemodeParams) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_params TEXT
    `);
    console.log("✅ Added active_gamemode_params column to rooms table");
  }

  const hasActiveGamemodeMods = roomColumns.some(
    (col: any) => col.name === "active_gamemode_mods",
  );
  if (!hasActiveGamemodeMods) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_mods TEXT
    `);
    console.log("✅ Added active_gamemode_mods column to rooms table");
  }

  const hasActiveGamemodeStartedAt = roomColumns.some(
    (col: any) => col.name === "active_gamemode_started_at_ms",
  );
  if (!hasActiveGamemodeStartedAt) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_started_at_ms INTEGER
    `);
    console.log("✅ Added active_gamemode_started_at_ms column to rooms table");
  }

  // Player sessions table - tracks real-time WebSocket connections
  db.exec(`
        CREATE TABLE IF NOT EXISTS player_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            room_id TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, room_id),
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    `);

  // Persistent room chat history. Rows are removed automatically when room is deleted.
  db.exec(`
        CREATE TABLE IF NOT EXISTS room_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          sender_user_id INTEGER,
          sender_peer_id INTEGER,
          sender_name TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

  // Create indexes for better query performance
  db.exec(`
        CREATE INDEX IF NOT EXISTS idx_rooms_gamemode ON rooms(gamemode);
        CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);
        CREATE INDEX IF NOT EXISTS idx_rooms_is_public ON rooms(is_public);
      CREATE INDEX IF NOT EXISTS idx_player_sessions_user_id ON player_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_player_sessions_room_id ON player_sessions(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_chat_messages_room_id_created_at ON room_chat_messages(room_id, created_at);
    `);

  console.log("Database migrations completed successfully");
}
