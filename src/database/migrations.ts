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
    DROP TABLE IF EXISTS room_match_participants;
    DROP TABLE IF EXISTS room_match_history;
    DROP TABLE IF EXISTS room_gamemode_history;
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
            selected_gamemode_index INTEGER,
            selected_gamemode_params TEXT,
            selected_gamemode_mods TEXT,
            active_gamemode_index INTEGER,
            active_gamemode_params TEXT,
            active_gamemode_mods TEXT,
            active_gamemode_started_at_ms INTEGER,
            active_gamemode_remaining_secs INTEGER,
            active_gamemode_running INTEGER DEFAULT 0,
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

  const hasActiveGamemodeRemainingSecs = roomColumns.some(
    (col: any) => col.name === "active_gamemode_remaining_secs",
  );
  if (!hasActiveGamemodeRemainingSecs) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_remaining_secs INTEGER
    `);
    console.log(
      "✅ Added active_gamemode_remaining_secs column to rooms table",
    );
  }

  const hasActiveGamemodeRunning = roomColumns.some(
    (col: any) => col.name === "active_gamemode_running",
  );
  if (!hasActiveGamemodeRunning) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN active_gamemode_running INTEGER DEFAULT 0
    `);
    db.exec(`
      UPDATE rooms
      SET active_gamemode_running = CASE
        WHEN active_gamemode_index IS NOT NULL THEN 1
        ELSE 0
      END
    `);
    console.log("✅ Added active_gamemode_running column to rooms table");
  }

  const hasSelectedGamemodeIndex = roomColumns.some(
    (col: any) => col.name === "selected_gamemode_index",
  );
  if (!hasSelectedGamemodeIndex) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN selected_gamemode_index INTEGER
    `);
    console.log("✅ Added selected_gamemode_index column to rooms table");
  }

  const hasSelectedGamemodeParams = roomColumns.some(
    (col: any) => col.name === "selected_gamemode_params",
  );
  if (!hasSelectedGamemodeParams) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN selected_gamemode_params TEXT
    `);
    console.log("✅ Added selected_gamemode_params column to rooms table");
  }

  const hasSelectedGamemodeMods = roomColumns.some(
    (col: any) => col.name === "selected_gamemode_mods",
  );
  if (!hasSelectedGamemodeMods) {
    db.exec(`
      ALTER TABLE rooms
      ADD COLUMN selected_gamemode_mods TEXT
    `);
    console.log("✅ Added selected_gamemode_mods column to rooms table");
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

  // Persistent gamemode sessions per room for start/end time auditing.
  db.exec(`
        CREATE TABLE IF NOT EXISTS room_gamemode_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          gamemode_index INTEGER NOT NULL,
          params_json TEXT,
          mods_json TEXT,
          timer_seconds INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER NOT NULL,
          duration_seconds INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
      `);

  // Temporary per-room match history (deleted with room), used as staging before Django transfer.
  db.exec(`
        CREATE TABLE IF NOT EXISTS room_match_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          gamemode TEXT NOT NULL,
          winner_user_id INTEGER,
          duration_seconds INTEGER NOT NULL,
          transferred_to_django INTEGER NOT NULL DEFAULT 0,
          django_match_id INTEGER,
          last_transfer_error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
      `);

  // Per-user participation rows for each room match history entry.
  db.exec(`
        CREATE TABLE IF NOT EXISTS room_match_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_history_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          kills INTEGER NOT NULL DEFAULT 0,
          deaths INTEGER NOT NULL DEFAULT 0,
          playtime_seconds INTEGER NOT NULL DEFAULT 0,
          won INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (match_history_id) REFERENCES room_match_history(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_room_gamemode_history_room_id_started_at ON room_gamemode_history(room_id, started_at_ms);
      CREATE INDEX IF NOT EXISTS idx_room_match_history_room_id_created_at ON room_match_history(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_room_match_participants_match_history_id ON room_match_participants(match_history_id);
    `);

  console.log("Database migrations completed successfully");
}
