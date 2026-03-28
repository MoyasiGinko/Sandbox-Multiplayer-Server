import express, { Request, Response } from "express";
import http from "http";
import config from "./config";
import {
  notifyAllClientsRoomsChanged,
  setupWebSocket,
} from "./networking/websocket";
import { runMigrations } from "./database/migrations";
import { RoomRepository } from "./database/repositories/roomRepository";
import authRoutes from "./api/authRoutes";
import roomRoutes from "./api/roomRoutes";
import statsRoutes from "./api/statsRoutes";
import userRoutes from "./api/userRoutes";
import worldRoutes from "./api/worldRoutes";
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
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/users", userRoutes);
app.use("/api/worlds", worldRoutes);
app.use("/api", statsRoutes);

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
  console.log(`  - POST /api/auth/register (Deprecated: use Django)`);
  console.log(`  - POST /api/auth/login (Deprecated: use Django)`);
  console.log(`  - GET  /api/auth/verify (Deprecated: use Django)`);
  console.log(`  - GET  /api/rooms (Server List)`);
  console.log(`  - GET  /api/rooms/:id`);
  console.log(`  - GET  /api/users (Deprecated: use Django)`);
  console.log(`  - GET  /api/users/online (Deprecated: use Django)`);
  console.log(`  - GET  /api/users/:id/stats (Deprecated: use Django)`);
  console.log(`  - GET  /api/leaderboard`);

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
