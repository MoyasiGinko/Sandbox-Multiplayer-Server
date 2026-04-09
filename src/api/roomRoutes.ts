import { Router, Request, Response } from "express";
import { RoomRepository } from "../database/repositories/roomRepository";
import { authenticateToken, AuthRequest } from "../auth/middleware";
import { notifyAllClientsRoomsChanged } from "../networking/websocket";
import {
  getCachedServerRoomCapacity,
  heartbeatGameServer,
  refreshServerRoomCapacity,
} from "../integration/djangoRegistry";

const router = Router();
const roomRepo = new RoomRepository();

async function syncRegistryRoomStateNow(): Promise<void> {
  const activeRooms = roomRepo.getAllActiveRooms();
  const currentPlayers = activeRooms.reduce(
    (sum, room) => sum + room.current_players,
    0,
  );
  const maxPlayers = activeRooms.reduce(
    (sum, room) => sum + room.max_players,
    0,
  );
  const currentRooms = roomRepo.countActiveRooms();

  try {
    await heartbeatGameServer(
      currentPlayers,
      maxPlayers > 0 ? maxPlayers : 64,
      currentRooms,
    );
  } catch (error) {
    console.warn("[RoomAPI] ⚠️ Failed immediate registry sync:", error);
  }
}

async function resolveAuthoritativeCapacityForCreate(
  activeRoomCount: number,
): Promise<{
  maxRooms: number | null;
  authoritativeCurrentRooms: number;
}> {
  let capacity = getCachedServerRoomCapacity();
  try {
    capacity = await refreshServerRoomCapacity();
  } catch (error) {
    console.warn(
      "[RoomAPI] ⚠️ Failed to refresh room capacity from Django:",
      error,
    );
  }

  return {
    maxRooms: capacity.maxRooms,
    // Use the larger value to avoid over-allocating when either side lags briefly.
    authoritativeCurrentRooms: Math.max(activeRoomCount, capacity.currentRooms),
  };
}

// Create a new room (requires authentication)
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { gamemode, mapName, maxPlayers, isPublic, server_id } = req.body;
    const userId = req.user?.userId;
    const username = req.user?.username;

    console.log("[RoomAPI] 🎯 CREATE ROOM REQUEST received");
    console.log("[RoomAPI] 👤 User ID: ", userId, " Username: ", username);
    console.log(
      "[RoomAPI] 📋 Room Config - Gamemode: ",
      gamemode,
      " Map: ",
      mapName,
    );
    console.log(
      "[RoomAPI] 👥 Max Players: ",
      maxPlayers,
      " Public: ",
      isPublic,
    );
    console.log("[RoomAPI] 🧭 Requested server_id:", server_id ?? "(none)");

    // Validate required fields
    if (!gamemode) {
      console.log("[RoomAPI] ❌ Validation failed: gamemode is required");
      res.status(400).json({ error: "gamemode is required" });
      return;
    }

    if (!userId || !username) {
      console.log("[RoomAPI] ❌ Validation failed: missing auth payload");
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const activeRoomCount = roomRepo.countActiveRooms();
    const capacity =
      await resolveAuthoritativeCapacityForCreate(activeRoomCount);

    const capacityKnown = capacity.maxRooms !== null;
    if (!capacityKnown) {
      res.status(503).json({
        error: "room_capacity_unavailable",
        message:
          "Server room capacity is unavailable. Please try again shortly.",
      });
      return;
    }

    if (
      capacityKnown &&
      capacity.authoritativeCurrentRooms >= (capacity.maxRooms as number)
    ) {
      console.log(
        "[RoomAPI] ❌ Room capacity reached:",
        capacity.authoritativeCurrentRooms,
        "/",
        capacity.maxRooms,
      );
      res.status(409).json({
        error: "room_capacity_reached",
        message: "Server room limit reached. No more rooms can be created.",
        current_rooms: capacity.authoritativeCurrentRooms,
        max_rooms: capacity.maxRooms,
      });
      return;
    }

    // Check if user already has an active room
    const existingRoom = roomRepo.getUserActiveRoomStrict(userId);
    if (existingRoom) {
      console.log(
        "[RoomAPI] ❌ User already has active room:",
        existingRoom.id,
      );
      res.status(400).json({
        error:
          "You are already active in a room. Leave that room first before creating another.",
        existing_room_id: existingRoom.id,
      });
      return;
    }

    // Generate unique room ID
    const roomId = `room_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    console.log("[RoomAPI] ✅ Generated room ID: ", roomId);

    // Create room
    console.log("[RoomAPI] 🔄 Creating room in database...");
    const room = roomRepo.createRoom({
      id: roomId,
      hostUserId: userId,
      hostUsername: username,
      gamemode,
      mapName: mapName || null,
      maxPlayers: maxPlayers || 8,
      isPublic: isPublic !== false,
    });
    console.log(
      "[RoomAPI] ✅ Room created successfully (current_players=0, awaiting WebSocket join)",
    );

    // Don't add host to player_sessions here - they'll be added when they
    // actually join via WebSocket. This keeps the count accurate.

    // Notify all connected clients that room list has changed
    console.log("[RoomAPI] 📢 Broadcasting room creation to all clients...");
    notifyAllClientsRoomsChanged();
    void syncRegistryRoomStateNow();

    console.log("[RoomAPI] 📤 Sending response with room data");
    res.status(201).json({
      success: true,
      room: {
        id: room.id,
        host_username: room.host_username,
        gamemode: room.gamemode,
        map_name: room.map_name,
        max_players: room.max_players,
        current_players: room.current_players,
        is_public: room.is_public,
      },
      server_capacity: {
        current_rooms: capacity.authoritativeCurrentRooms,
        max_rooms: capacity.maxRooms,
        can_create_room:
          capacity.maxRooms === null
            ? false
            : capacity.authoritativeCurrentRooms < capacity.maxRooms,
        capacity_source: capacityKnown ? "registry" : "degraded_local",
      },
    });
  } catch (error) {
    console.error("[RoomAPI] ❌ ERROR creating room - Full Error:", error);
    if (error instanceof Error) {
      console.error("[RoomAPI] ❌ Error message:", error.message);
      console.error("[RoomAPI] ❌ Error stack:", error.stack);
    }
    res
      .status(500)
      .json({ error: "Internal server error", details: String(error) });
  }
});

// Get all public active rooms (SERVER LIST ENDPOINT)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { gamemode } = req.query;

    const rooms = roomRepo.getAllActiveRooms(gamemode as string | undefined);

    // Transform to include calculated fields
    const roomList = rooms.map((room) => ({
      id: room.id,
      host_username: room.host_username,
      gamemode: room.gamemode,
      map_name: room.map_name,
      current_players: room.current_players,
      max_players: room.max_players,
      created_at: room.created_at,
      is_full: room.current_players >= room.max_players,
    }));

    let capacity = getCachedServerRoomCapacity();
    try {
      capacity = await refreshServerRoomCapacity();
    } catch (error) {
      console.warn(
        "[RoomAPI] ⚠️ Failed to refresh room capacity for list:",
        error,
      );
    }

    const currentRooms = roomRepo.countActiveRooms();
    res.json({
      count: roomList.length,
      rooms: roomList,
      server_capacity: {
        current_rooms: currentRooms,
        max_rooms: capacity.maxRooms,
        can_create_room:
          capacity.maxRooms === null ? true : currentRooms < capacity.maxRooms,
      },
    });
  } catch (error) {
    console.error("[RoomAPI] ❌ ERROR fetching rooms:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Read recent match history (fallback for clients when Django history endpoint is unavailable)
router.get("/matches/history", async (req: Request, res: Response) => {
  try {
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string"
        ? Math.max(1, Math.min(Number.parseInt(limitRaw, 10) || 50, 200))
        : 50;

    const matches = roomRepo.getRecentRoomMatchHistory(limit).map((match) => {
      const participants = roomRepo
        .getRoomMatchParticipants(match.id)
        .map((p) => {
          const username = String(p.username ?? "").trim();
          const displayName = String(p.display_name ?? "").trim();
          const name =
            displayName.length > 0
              ? displayName
              : username.length > 0
                ? username
                : `User ${p.user_id}`;
          return {
            user_id: p.user_id,
            username: username.length > 0 ? username : name,
            display_name: name,
            team: String(p.team ?? "Default"),
            kills: p.kills,
            deaths: p.deaths,
            score: p.score,
            playtime_seconds: p.playtime_seconds,
            won: p.won > 0,
          };
        });

      const mvp = participants.reduce<null | (typeof participants)[number]>(
        (best, current) => {
          if (!best) {
            return current;
          }
          if (current.score !== best.score) {
            return current.score > best.score ? current : best;
          }
          if (current.kills !== best.kills) {
            return current.kills > best.kills ? current : best;
          }
          if (current.deaths !== best.deaths) {
            return current.deaths < best.deaths ? current : best;
          }
          return best;
        },
        null,
      );

      const teams: Record<string, typeof participants> = {};
      for (const participant of participants) {
        const teamName =
          participant.team.trim().length > 0 ? participant.team : "Default";
        if (!teams[teamName]) {
          teams[teamName] = [];
        }
        teams[teamName].push(participant);
      }

      const winnerType = String(match.winner_type ?? "").trim();
      const isDraw =
        winnerType === "draw" ||
        (winnerType.length === 0 &&
          match.winner_user_id === null &&
          !participants.some((p) => p.won));
      let winnerName = "Draw";
      if (!isDraw) {
        if (winnerType === "team") {
          winnerName = String(match.winner_team ?? "Unknown Team");
        } else if (match.winner_user_id !== null) {
          const winner = participants.find(
            (p) => p.user_id === match.winner_user_id,
          );
          winnerName =
            winner?.display_name ??
            winner?.username ??
            `User ${match.winner_user_id}`;
        } else {
          winnerName = "Unknown";
        }
      }

      return {
        id: match.id,
        room_id: match.room_id,
        gamemode: match.gamemode,
        winner_user_id: match.winner_user_id,
        winner_type:
          winnerType.length > 0 ? winnerType : isDraw ? "draw" : "player",
        winner_team: match.winner_team,
        winner_name: winnerName,
        is_draw: isDraw,
        game_started_at_ms: match.game_started_at_ms,
        game_ended_at_ms: match.game_ended_at_ms,
        duration_seconds: match.duration_seconds,
        created_at: match.created_at,
        transferred_to_django: match.transferred_to_django,
        django_match_id: match.django_match_id,
        mvp:
          mvp === null
            ? null
            : {
                user_id: mvp.user_id,
                username: mvp.username,
                display_name: mvp.display_name,
                team: mvp.team,
                score: mvp.score,
                kills: mvp.kills,
                deaths: mvp.deaths,
              },
        teams,
        players: participants,
      };
    });

    res.json({
      count: matches.length,
      matches,
      source: "node-room-history",
    });
  } catch (error) {
    console.error("[RoomAPI] ❌ ERROR fetching match history:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get specific room details
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const room = roomRepo.getRoomById(id);

    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json(room);
  } catch (error) {
    console.error("[RoomAPI] ❌ ERROR fetching room:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
