import express, { Request, Response } from "express";
import http from "http";
import config from "./config";
import {
  notifyAllClientsRoomsChanged,
  setupWebSocket,
} from "./networking/websocket";
import { runMigrations } from "./database/migrations";
import { RoomRepository } from "./database/repositories/roomRepository";
import roomRoutes from "./api/roomRoutes";
import {
  heartbeatGameServer,
  registerGameServer,
} from "./integration/djangoRegistry";

const app = express();
const server = http.createServer(app);
const roomRepo = new RoomRepository();

// Middleware
app.use(express.json());

// Run database migrations
console.log("Initializing database...");
runMigrations();

// API Routes
app.use("/api/rooms", roomRoutes);

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, env: config.env });
});

// Setup WebSocket
setupWebSocket(server);

// One-time startup hygiene for lingering active rooms with no players.
const markedStartup = roomRepo.deactivateStaleEmptyActiveRooms(1);
if (markedStartup > 0) {
  console.log(
    `🧹 Startup marked ${markedStartup} stale empty active room(s) inactive`,
  );
}

server.on("error", (error: NodeJS.ErrnoException) => {
  const code = error.code || "UNKNOWN";
  console.error(`❌ Server failed to start (${code}): ${error.message}`);
  if (code === "EADDRINUSE") {
    console.error(
      `❌ Port ${config.port} is already in use. Stop the old backend process before starting a new one.`,
    );
  }
  process.exit(1);
});

// Periodic cleanup of inactive rooms (every 30 seconds, delete rooms inactive for 1+ minute)
setInterval(() => {
  const markedInactive = roomRepo.deactivateStaleEmptyActiveRooms(1);
  if (markedInactive > 0) {
    console.log(
      `🧹 Marked ${markedInactive} stale empty active room(s) inactive`,
    );
  }

  const cleaned = roomRepo.cleanupInactiveRooms(1);
  if (cleaned > 0) {
    console.log(`🗑️  Cleaned up ${cleaned} inactive room(s)`);
  }

  if (markedInactive > 0 || cleaned > 0) {
    notifyAllClientsRoomsChanged();
  }
}, 30 * 1000);

function collectRegistryStats(): {
  currentPlayers: number;
  maxPlayers: number;
} {
  const activeRooms = roomRepo.getAllActiveRooms();
  const currentPlayers = activeRooms.reduce(
    (sum, room) => sum + room.current_players,
    0,
  );
  const maxPlayers = activeRooms.reduce(
    (sum, room) => sum + room.max_players,
    0,
  );
  return {
    currentPlayers,
    maxPlayers: maxPlayers > 0 ? maxPlayers : 64,
  };
}

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${config.port} (pid=${process.pid})`);
  console.log(`API endpoints available:`);
  console.log(`  - GET  /api/rooms (Server List)`);
  console.log(`  - GET  /api/rooms/:id`);

  const initial = collectRegistryStats();
  registerGameServer(initial.currentPlayers, initial.maxPlayers)
    .then(() => {
      console.log(
        `📡 Registered with Django registry at ${config.djangoRegistryBaseUrl}`,
      );
    })
    .catch((error: Error) => {
      console.warn(`⚠️ Registry registration failed: ${error.message}`);
    });
});

setInterval(() => {
  const stats = collectRegistryStats();
  heartbeatGameServer(stats.currentPlayers, stats.maxPlayers).catch(
    (error: Error) => {
      console.warn(`⚠️ Registry heartbeat failed: ${error.message}`);
    },
  );
}, 15 * 1000);
