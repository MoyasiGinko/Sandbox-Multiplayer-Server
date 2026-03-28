import { Router, Request, Response } from "express";
import { RoomRepository } from "../database/repositories/roomRepository";
import { authenticateToken, AuthRequest } from "../auth/middleware";
import { notifyAllClientsRoomsChanged } from "../networking/websocket";

const router = Router();
const roomRepo = new RoomRepository();

// Create a new room (requires authentication)
router.post("/", authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { gamemode, mapName, maxPlayers, isPublic } = req.body;
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
    res.json({
      count: roomList.length,
      rooms: roomList,
    });
  } catch (error) {
    console.error("[RoomAPI] ❌ ERROR fetching rooms:", error);
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
