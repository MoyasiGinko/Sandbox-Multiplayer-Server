import { getDatabase } from "../connection";

export interface Room {
  id: string;
  host_user_id: number;
  host_username: string;
  gamemode: string;
  map_name: string | null;
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
