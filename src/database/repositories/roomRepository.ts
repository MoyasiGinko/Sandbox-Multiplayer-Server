import { getDatabase } from "../connection";

export interface Room {
  id: string;
  host_user_id: number;
  host_username: string;
  gamemode: string;
  map_name: string | null;
  selected_gamemode_index: number | null;
  selected_gamemode_params: string | null;
  selected_gamemode_mods: string | null;
  active_gamemode_index: number | null;
  active_gamemode_params: string | null;
  active_gamemode_mods: string | null;
  active_gamemode_started_at_ms: number | null;
  active_gamemode_remaining_secs: number | null;
  active_gamemode_running: number;
  max_players: number;
  current_players: number;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
  started_at: string | null;
  inactive_since: string | null;
}

export interface CreateRoomInput {
  id: string;
  hostUserId: number;
  hostUsername: string;
  gamemode: string;
  mapName?: string;
  maxPlayers?: number;
  isPublic?: boolean;
}

export interface RoomChatMessage {
  id: number;
  room_id: string;
  sender_user_id: number | null;
  sender_peer_id: number | null;
  sender_name: string;
  message: string;
  created_at: string;
}

export interface RoomGamemodeHistoryEntry {
  id: number;
  room_id: string;
  gamemode_index: number;
  params_json: string | null;
  mods_json: string | null;
  timer_seconds: number;
  started_at_ms: number;
  ended_at_ms: number;
  duration_seconds: number;
  created_at: string;
}

export interface RoomMatchHistoryEntry {
  id: number;
  room_id: string;
  gamemode: string;
  winner_user_id: number | null;
  duration_seconds: number;
  transferred_to_django: number;
  django_match_id: number | null;
  last_transfer_error: string | null;
  created_at: string;
}

export interface RoomMatchParticipantEntry {
  id: number;
  match_history_id: number;
  user_id: number;
  kills: number;
  deaths: number;
  playtime_seconds: number;
  won: number;
}

export type AddPlayerSessionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "user_already_in_target_room" | "user_already_in_other_room";
      existingRoomId: string;
    }
  | {
      ok: false;
      reason: "database_error";
      existingRoomId?: undefined;
    };

export class RoomRepository {
  private db = getDatabase();

  addRoomMatchHistory(input: {
    roomId: string;
    gamemode: string;
    winnerUserId: number | null;
    durationSeconds: number;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO room_match_history (
        room_id,
        gamemode,
        winner_user_id,
        duration_seconds
      )
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.roomId,
      input.gamemode,
      input.winnerUserId,
      Math.max(0, Math.floor(input.durationSeconds)),
    );
    return Number(result.lastInsertRowid);
  }

  addRoomMatchParticipants(
    matchHistoryId: number,
    players: Array<{
      user_id: number;
      kills?: number;
      deaths?: number;
      playtime_seconds?: number;
      won?: boolean;
    }>,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO room_match_participants (
        match_history_id,
        user_id,
        kills,
        deaths,
        playtime_seconds,
        won
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction(
      (
        participants: Array<{
          user_id: number;
          kills?: number;
          deaths?: number;
          playtime_seconds?: number;
          won?: boolean;
        }>,
      ) => {
        for (const player of participants) {
          stmt.run(
            matchHistoryId,
            player.user_id,
            Math.max(0, Number.parseInt(String(player.kills ?? 0), 10) || 0),
            Math.max(0, Number.parseInt(String(player.deaths ?? 0), 10) || 0),
            Math.max(
              0,
              Number.parseInt(String(player.playtime_seconds ?? 0), 10) || 0,
            ),
            player.won ? 1 : 0,
          );
        }
      },
    );
    insertMany(players);
  }

  markRoomMatchHistoryTransferred(
    matchHistoryId: number,
    djangoMatchId: number | null,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE room_match_history
      SET transferred_to_django = 1,
          django_match_id = ?,
          last_transfer_error = NULL
      WHERE id = ?
    `);
    stmt.run(djangoMatchId, matchHistoryId);
  }

  markRoomMatchHistoryTransferFailed(
    matchHistoryId: number,
    errorMessage: string,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE room_match_history
      SET transferred_to_django = 0,
          last_transfer_error = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage.slice(0, 500), matchHistoryId);
  }

  getPendingRoomMatchHistory(limit: number = 25): RoomMatchHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const stmt = this.db.prepare(`
      SELECT rmh.*
      FROM room_match_history rmh
      INNER JOIN rooms r ON r.id = rmh.room_id
      WHERE rmh.transferred_to_django = 0
        AND r.is_active = 1
      ORDER BY rmh.id ASC
      LIMIT ?
    `);
    return stmt.all(safeLimit) as RoomMatchHistoryEntry[];
  }

  getRoomMatchParticipants(
    matchHistoryId: number,
  ): RoomMatchParticipantEntry[] {
    const stmt = this.db.prepare(`
      SELECT id, match_history_id, user_id, kills, deaths, playtime_seconds, won
      FROM room_match_participants
      WHERE match_history_id = ?
      ORDER BY id ASC
    `);
    return stmt.all(matchHistoryId) as RoomMatchParticipantEntry[];
  }

  addRoomGamemodeHistory(input: {
    roomId: string;
    gamemodeIndex: number;
    params: unknown[];
    mods: unknown[];
    timerSeconds: number;
    startedAtMs: number;
    endedAtMs: number;
    durationSeconds: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO room_gamemode_history (
        room_id,
        gamemode_index,
        params_json,
        mods_json,
        timer_seconds,
        started_at_ms,
        ended_at_ms,
        duration_seconds
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.roomId,
      input.gamemodeIndex,
      JSON.stringify(Array.isArray(input.params) ? input.params : []),
      JSON.stringify(Array.isArray(input.mods) ? input.mods : []),
      Math.max(1, Math.floor(input.timerSeconds)),
      Math.max(0, Math.floor(input.startedAtMs)),
      Math.max(0, Math.floor(input.endedAtMs)),
      Math.max(0, Math.floor(input.durationSeconds)),
    );
  }

  addRoomChatMessage(input: {
    roomId: string;
    senderUserId?: number | null;
    senderPeerId?: number | null;
    senderName: string;
    message: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO room_chat_messages (room_id, sender_user_id, sender_peer_id, sender_name, message)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.roomId,
      input.senderUserId ?? null,
      input.senderPeerId ?? null,
      input.senderName,
      input.message,
    );
  }

  getRecentRoomChatMessages(
    roomId: string,
    limit: number = 50,
  ): RoomChatMessage[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const stmt = this.db.prepare(`
      SELECT id, room_id, sender_user_id, sender_peer_id, sender_name, message, created_at
      FROM room_chat_messages
      WHERE room_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(roomId, safeLimit) as RoomChatMessage[];
    return rows.reverse();
  }

  createRoom(input: CreateRoomInput): Room {
    const stmt = this.db.prepare(`
            INSERT INTO rooms (id, host_user_id, host_username, gamemode, map_name, max_players, current_players, is_public)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `);

    stmt.run(
      input.id,
      input.hostUserId,
      input.hostUsername,
      input.gamemode,
      input.mapName || null,
      input.maxPlayers || 8,
      input.isPublic !== false ? 1 : 0,
    );

    return this.getRoomById(input.id)!;
  }

  getRoomById(id: string): Room | null {
    const stmt = this.db.prepare("SELECT * FROM rooms WHERE id = ?");
    return stmt.get(id) as Room | null;
  }

  getAllActiveRooms(gamemode?: string): Room[] {
    let query =
      "SELECT * FROM rooms WHERE is_active = 1 AND is_public = 1 AND current_players > 0";
    const params: any[] = [];

    if (gamemode) {
      query += " AND gamemode = ?";
      params.push(gamemode);
    }

    query += " ORDER BY created_at DESC";

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Room[];
  }

  countActiveRooms(): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM rooms WHERE is_active = 1 AND current_players > 0",
    );
    const result = stmt.get() as { count: number };
    return result.count;
  }

  updatePlayerCount(roomId: string, count: number): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET current_players = ?
            WHERE id = ?
        `);
    stmt.run(count, roomId);
  }

  updateRoomHost(
    roomId: string,
    hostUserId: number,
    hostUsername: string,
  ): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET host_user_id = ?,
                host_username = ?
            WHERE id = ?
        `);
    stmt.run(hostUserId, hostUsername, roomId);
  }

  setRoomActive(roomId: string, isActive: boolean): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET is_active = ?,
                inactive_since = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
            WHERE id = ?
        `);
    stmt.run(isActive ? 1 : 0, isActive ? 1 : 0, roomId);
  }

  setRoomStarted(roomId: string): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET started_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
    stmt.run(roomId);
  }

  setSelectedGamemodeState(
    roomId: string,
    index: number,
    params: unknown[],
    mods: unknown[],
  ): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET selected_gamemode_index = ?,
                selected_gamemode_params = ?,
                selected_gamemode_mods = ?
            WHERE id = ?
        `);
    stmt.run(
      index,
      JSON.stringify(Array.isArray(params) ? params : []),
      JSON.stringify(Array.isArray(mods) ? mods : []),
      roomId,
    );
  }

  clearSelectedGamemodeState(roomId: string): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET selected_gamemode_index = NULL,
                selected_gamemode_params = NULL,
                selected_gamemode_mods = NULL
            WHERE id = ?
        `);
    stmt.run(roomId);
  }

  setActiveGamemodeState(
    roomId: string,
    index: number,
    params: unknown[],
    mods: unknown[],
    startedAtMs: number,
    remainingSecs: number | null = null,
    running: boolean = true,
  ): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET active_gamemode_index = ?,
                active_gamemode_params = ?,
                active_gamemode_mods = ?,
                active_gamemode_started_at_ms = ?,
                active_gamemode_remaining_secs = ?,
                active_gamemode_running = ?
            WHERE id = ?
        `);
    stmt.run(
      index,
      JSON.stringify(Array.isArray(params) ? params : []),
      JSON.stringify(Array.isArray(mods) ? mods : []),
      startedAtMs,
      remainingSecs,
      running ? 1 : 0,
      roomId,
    );
  }

  clearActiveGamemodeState(roomId: string): void {
    const stmt = this.db.prepare(`
            UPDATE rooms
            SET active_gamemode_index = NULL,
                active_gamemode_params = NULL,
                active_gamemode_mods = NULL,
              active_gamemode_started_at_ms = NULL,
                active_gamemode_remaining_secs = NULL,
                active_gamemode_running = 0
            WHERE id = ?
        `);
    stmt.run(roomId);
  }

  deleteRoom(roomId: string): void {
    const stmt = this.db.prepare("DELETE FROM rooms WHERE id = ?");
    stmt.run(roomId);
  }

  cleanupInactiveRooms(olderThanMinutes: number = 1): number {
    const stmt = this.db.prepare(`
            DELETE FROM rooms
            WHERE is_active = 0
            AND inactive_since IS NOT NULL
            AND datetime(inactive_since) < datetime('now', '-' || ? || ' minutes')
        `);
    const result = stmt.run(olderThanMinutes);
    if (result.changes > 0) {
      console.log(
        `[RoomRepo] 🧹 Cleaned up ${result.changes} inactive room(s) older than ${olderThanMinutes} minute(s)`,
      );
    }
    return result.changes;
  }

  // Mark stale active rooms with zero players as inactive so they can be cleaned up.
  deactivateStaleEmptyActiveRooms(olderThanMinutes: number = 1): number {
    const stmt = this.db.prepare(`
      UPDATE rooms
      SET is_active = 0,
          inactive_since = COALESCE(inactive_since, CURRENT_TIMESTAMP)
      WHERE is_active = 1
        AND current_players <= 0
        AND datetime(created_at) < datetime('now', '-' || ? || ' minutes')
    `);
    const result = stmt.run(olderThanMinutes);
    if (result.changes > 0) {
      console.log(
        `[RoomRepo] 💤 Marked ${result.changes} stale empty active room(s) inactive`,
      );
    }
    return result.changes;
  }

  // Deactivate room if no players remain
  deactivateIfEmpty(roomId: string): boolean {
    const room = this.getRoomById(roomId);
    if (!room) return false;

    if (room.current_players <= 0) {
      console.log(`[RoomRepo] 📭 Room ${roomId} is empty; marking inactive`);
      this.setRoomActive(roomId, false);
      return true;
    }
    return false;
  }

  // Add player to room session (WebSocket join)
  addPlayerSession(userId: number, roomId: string): AddPlayerSessionResult {
    try {
      // Check if player is already in this exact room
      const checkStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM player_sessions WHERE user_id = ? AND room_id = ?",
      );
      const existing = checkStmt.get(userId, roomId) as { count: number };

      if (existing.count > 0) {
        console.log(
          `[RoomRepo] ⛔ Player ${userId} already active in target room ${roomId}`,
        );
        return {
          ok: false,
          reason: "user_already_in_target_room",
          existingRoomId: roomId,
        };
      }

      // If the user is active in any other room, block this join.
      const checkOtherStmt = this.db.prepare(
        "SELECT room_id FROM player_sessions WHERE user_id = ?",
      );
      const otherRoom = checkOtherStmt.get(userId) as
        | { room_id: string }
        | undefined;

      if (otherRoom) {
        console.log(
          `[RoomRepo] ⛔ Player ${userId} already active in room ${otherRoom.room_id}; blocking join to ${roomId}`,
        );
        return {
          ok: false,
          reason: "user_already_in_other_room",
          existingRoomId: otherRoom.room_id,
        };
      }

      // Add to new room
      const stmt_insert = this.db.prepare(`
        INSERT INTO player_sessions (user_id, room_id)
        VALUES (?, ?)
      `);
      stmt_insert.run(userId, roomId);
      console.log(`[RoomRepo] ✅ Player ${userId} added to room ${roomId}`);

      // Update room player count based on actual player_sessions count
      // (not the stale count from the room record)
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM player_sessions WHERE room_id = ?",
      );
      const countResult = countStmt.get(roomId) as { count: number };
      const actualCount = countResult.count;
      this.updatePlayerCount(roomId, actualCount);
      console.log(
        `[RoomRepo] 👥 Room ${roomId} updated to actual player count: ${actualCount}`,
      );
      return { ok: true };
    } catch (error) {
      console.error(`[RoomRepo] ❌ Error adding player session:`, error);

      // Handle uniqueness races deterministically (same user already has active session).
      const existingRoom = this.getPlayerCurrentRoom(userId);
      if (existingRoom) {
        return {
          ok: false,
          reason:
            existingRoom.id === roomId
              ? "user_already_in_target_room"
              : "user_already_in_other_room",
          existingRoomId: existingRoom.id,
        };
      }

      return { ok: false, reason: "database_error" };
    }
  }

  // Remove player from room session (WebSocket disconnect)
  removePlayerSession(userId: number, roomId: string): boolean {
    try {
      const stmt = this.db.prepare(
        "DELETE FROM player_sessions WHERE user_id = ? AND room_id = ?",
      );
      stmt.run(userId, roomId);
      console.log(`[RoomRepo] ❌ Player ${userId} removed from room ${roomId}`);

      // Recalculate room player count from authoritative sessions table.
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM player_sessions WHERE room_id = ?",
      );
      const countResult = countStmt.get(roomId) as { count: number };
      const actualCount = countResult.count;
      this.updatePlayerCount(roomId, actualCount);
      console.log(
        `[RoomRepo] 👥 Room ${roomId} player count synced to actual sessions: ${actualCount}`,
      );

      // Deactivate immediately when the room becomes empty.
      if (actualCount <= 0) {
        this.deactivateIfEmpty(roomId);
      }
      return true;
    } catch (error) {
      console.error(`[RoomRepo] ❌ Error removing player session:`, error);
      return false;
    }
  }

  // Get player's current room (if in one)
  getPlayerCurrentRoom(userId: number): Room | null {
    try {
      const stmt = this.db.prepare(`
        SELECT r.* FROM rooms r
        INNER JOIN player_sessions ps ON r.id = ps.room_id
        WHERE ps.user_id = ? AND r.is_active = 1
        LIMIT 1
      `);
      const result = stmt.get(userId) as Room | null;
      if (result) {
        console.log(
          `[RoomRepo] 🎯 Player ${userId} has active room: ${result.id}`,
        );
      } else {
        console.log(`[RoomRepo] ✅ Player ${userId} has no active room`);
      }
      return result;
    } catch (error) {
      console.error(`[RoomRepo] ❌ Error getting player current room:`, error);
      return null;
    }
  }

  // Strict active-room lookup by immutable identity.
  // Returns an active room if user is either host OR has a player session.
  getUserActiveRoomStrict(userId: number): Room | null {
    try {
      const stmt = this.db.prepare(`
        SELECT DISTINCT r.*
        FROM rooms r
        LEFT JOIN player_sessions ps
          ON ps.room_id = r.id AND ps.user_id = ?
        WHERE r.is_active = 1
          AND (r.host_user_id = ? OR ps.user_id IS NOT NULL)
        ORDER BY r.created_at DESC
        LIMIT 1
      `);
      const result = stmt.get(userId, userId) as Room | null;
      if (result) {
        console.log(
          `[RoomRepo] 🔒 Strict active room for user ${userId}: ${result.id}`,
        );
      }
      return result;
    } catch (error) {
      console.error(`[RoomRepo] ❌ Error getting strict active room:`, error);
      return null;
    }
  }

  // Returns any active room for this user that is NOT the provided target room.
  // Used by join flow to avoid false positives when the user is joining their own newly-created room.
  getUserConflictingActiveRoom(
    userId: number,
    targetRoomId: string,
  ): Room | null {
    try {
      const stmt = this.db.prepare(`
        SELECT DISTINCT r.*
        FROM rooms r
        LEFT JOIN player_sessions ps
          ON ps.room_id = r.id AND ps.user_id = ?
        WHERE r.is_active = 1
          AND (r.host_user_id = ? OR ps.user_id IS NOT NULL)
          AND r.id != ?
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      `);
      const result = stmt.get(userId, userId, targetRoomId) as Room | null;
      if (result) {
        console.log(
          `[RoomRepo] ⛔ Conflicting active room for user ${userId}: ${result.id} (target=${targetRoomId})`,
        );
      }
      return result;
    } catch (error) {
      console.error(
        `[RoomRepo] ❌ Error getting conflicting active room:`,
        error,
      );
      return null;
    }
  }
}
