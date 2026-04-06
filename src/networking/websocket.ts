import { WebSocketServer, WebSocket, RawData } from "ws";
import http from "http";
import { logInfo, logError, logWarning } from "../utils/logger";
import { RoomManager, GameRoom } from "../game/roomManager";
import { verifyTokenWithFallback } from "../auth/jwt";
import { RoomRepository } from "../database/repositories/roomRepository";
import { heartbeatGameServer } from "../integration/djangoRegistry";
import {
  reportMatchToDjango,
  MatchPlayerReport,
} from "../integration/djangoMatchReporter";

type Message = { type: string; data?: unknown };

type ClientSession = {
  ws: WebSocket;
  peerId: number | null;
  roomId: string | null;
  username: string;
  name: string;
  version: string;
  ip: string;
  userId: number | null; // Added for authenticated users
  isAuthenticated: boolean; // Track if user is authenticated
  accessToken: string | null;
};

type ActiveGamemodePayload = {
  index: number;
  params: unknown[];
  mods: unknown[];
  startedAtMs: number;
  remainingSecs: number;
};

type SelectedGamemodePayload = {
  index: number;
  params: unknown[];
  mods: unknown[];
};

const roomManager = new RoomManager();
const clientSessions = new Map<WebSocket, ClientSession>();
const roomRepo = new RoomRepository();
const activeUserRoomLocks = new Map<
  number,
  { roomId: string; ws: WebSocket }
>();
const MATCH_TRANSFER_RETRY_INTERVAL_MS = 10_000;
let _matchTransferRetryLoopStarted = false;
let _matchTransferRetryInProgress = false;

function findAccessTokenForRoom(roomId: string): string | null {
  for (const session of clientSessions.values()) {
    if (
      session.roomId === roomId &&
      session.isAuthenticated &&
      typeof session.accessToken === "string" &&
      session.accessToken.trim().length > 0
    ) {
      return session.accessToken;
    }
  }
  return null;
}

async function retryPendingRoomMatchTransfers(): Promise<void> {
  if (_matchTransferRetryInProgress) {
    return;
  }
  _matchTransferRetryInProgress = true;
  try {
    const pendingMatches = roomRepo.getPendingRoomMatchHistory(25);
    if (pendingMatches.length === 0) {
      return;
    }

    for (const pending of pendingMatches) {
      const accessToken = findAccessTokenForRoom(pending.room_id);
      if (!accessToken) {
        // Retry later when an authenticated room participant is connected.
        continue;
      }

      const participants = roomRepo
        .getRoomMatchParticipants(pending.id)
        .map((entry) => {
          return {
            user_id: entry.user_id,
            kills: Math.max(0, entry.kills),
            deaths: Math.max(0, entry.deaths),
            playtime_seconds: Math.max(0, entry.playtime_seconds),
            won: entry.won > 0,
          } satisfies MatchPlayerReport;
        });

      if (participants.length === 0) {
        roomRepo.markRoomMatchHistoryTransferFailed(
          pending.id,
          "No match participants available for transfer",
        );
        continue;
      }

      try {
        const result = await reportMatchToDjango(accessToken, {
          room_id: pending.room_id,
          gamemode: pending.gamemode,
          winner_user_id: pending.winner_user_id,
          duration_seconds: pending.duration_seconds,
          players: participants,
        });
        roomRepo.markRoomMatchHistoryTransferred(
          pending.id,
          typeof result.match_id === "number" ? result.match_id : null,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        roomRepo.markRoomMatchHistoryTransferFailed(pending.id, errorMessage);
      }
    }
  } finally {
    _matchTransferRetryInProgress = false;
  }
}

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
    logWarning(
      `registry sync failed after room state change: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type IdentityValidationResult =
  | {
      ok: true;
      userId: number;
      username: string;
      displayName: string;
    }
  | {
      ok: false;
      reason: string;
      message: string;
    };

function getClientIp(ws: WebSocket): string {
  const remoteAddr =
    (ws as any).remoteAddress ||
    (ws as any)._socket?.remoteAddress ||
    "unknown";
  return remoteAddr === "::1" || remoteAddr === "127.0.0.1"
    ? "localhost"
    : remoteAddr;
}

function send(ws: WebSocket, type: string, data: unknown = {}) {
  try {
    ws.send(JSON.stringify({ type, data } satisfies Message));
  } catch (e) {
    logError(`send failed: ${String(e)}`);
  }
}

function broadcast(
  room: GameRoom,
  type: string,
  data: unknown,
  excludePeerId?: number,
) {
  for (const client of room.clients.values()) {
    if (excludePeerId && client.peerId === excludePeerId) continue;
    const session = Array.from(clientSessions.values()).find(
      (s) => s.roomId === room.id && s.peerId === client.peerId,
    );
    if (session) {
      send(session.ws, type, data);
    }
  }
}

function broadcastToAll(type: string, data: unknown) {
  /**Broadcast to all connected WebSocket clients*/
  for (const session of clientSessions.values()) {
    send(session.ws, type, data);
  }
}

function validateJson(raw: string): Message | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === "string") return parsed as Message;
    return null;
  } catch {
    return null;
  }
}

function parseDbActiveGamemode(
  dbRoom: ReturnType<RoomRepository["getRoomById"]>,
): ActiveGamemodePayload | null {
  if (!dbRoom) {
    return null;
  }
  if (
    dbRoom.active_gamemode_index === null ||
    dbRoom.active_gamemode_started_at_ms === null
  ) {
    return null;
  }

  let params: unknown[] = [];
  let mods: unknown[] = [];
  try {
    const parsedParams = dbRoom.active_gamemode_params
      ? JSON.parse(dbRoom.active_gamemode_params)
      : [];
    params = Array.isArray(parsedParams) ? parsedParams : [];
  } catch {
    params = [];
  }
  try {
    const parsedMods = dbRoom.active_gamemode_mods
      ? JSON.parse(dbRoom.active_gamemode_mods)
      : [];
    mods = Array.isArray(parsedMods) ? parsedMods : [];
  } catch {
    mods = [];
  }

  return {
    index: dbRoom.active_gamemode_index,
    params,
    mods,
    startedAtMs: dbRoom.active_gamemode_started_at_ms,
    remainingSecs:
      typeof dbRoom.active_gamemode_remaining_secs === "number" &&
      dbRoom.active_gamemode_remaining_secs >= 0
        ? Math.max(1, Math.floor(dbRoom.active_gamemode_remaining_secs))
        : calculateRemainingSecs(dbRoom.active_gamemode_started_at_ms, params),
  };
}

function parseDbSelectedGamemode(
  dbRoom: ReturnType<RoomRepository["getRoomById"]>,
): SelectedGamemodePayload | null {
  if (!dbRoom || dbRoom.selected_gamemode_index === null) {
    return null;
  }
  let params: unknown[] = [];
  let mods: unknown[] = [];
  try {
    const parsedParams = dbRoom.selected_gamemode_params
      ? JSON.parse(dbRoom.selected_gamemode_params)
      : [];
    params = Array.isArray(parsedParams) ? parsedParams : [];
  } catch {
    params = [];
  }
  try {
    const parsedMods = dbRoom.selected_gamemode_mods
      ? JSON.parse(dbRoom.selected_gamemode_mods)
      : [];
    mods = Array.isArray(parsedMods) ? parsedMods : [];
  } catch {
    mods = [];
  }
  return {
    index: dbRoom.selected_gamemode_index,
    params,
    mods,
  };
}

function calculateRemainingSecs(
  startedAtMs: number,
  params: unknown[],
): number {
  const firstParam =
    Array.isArray(params) && params.length > 0 ? params[0] : 10;
  const minutesRaw =
    typeof firstParam === "number"
      ? firstParam
      : Number.parseInt(String(firstParam ?? 10), 10);
  const totalSecs = Math.max(
    1,
    Math.floor((Number.isFinite(minutesRaw) ? minutesRaw : 10) * 60),
  );
  const nowMs = Date.now();
  const elapsedSecs = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return Math.max(1, totalSecs - elapsedSecs);
}

function totalGamemodeSecondsFromParams(params: unknown[]): number {
  const firstParam =
    Array.isArray(params) && params.length > 0 ? params[0] : 10;
  const minutesRaw =
    typeof firstParam === "number"
      ? firstParam
      : Number.parseInt(String(firstParam ?? 10), 10);
  return Math.max(
    1,
    Math.floor((Number.isFinite(minutesRaw) ? minutesRaw : 10) * 60),
  );
}

function toSafeMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  return Math.floor(value);
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recalculateStartedAtFromTimer(
  nowMs: number,
  remainingSecsRaw: unknown,
  totalSecsRaw: unknown,
): number | null {
  const remainingSecs = Math.max(0, parseNumber(remainingSecsRaw, -1));
  const totalSecs = Math.max(1, parseNumber(totalSecsRaw, -1));
  if (remainingSecs < 0 || totalSecs <= 0) {
    return null;
  }
  const elapsedSecs = Math.max(0, totalSecs - remainingSecs);
  return Math.max(0, Math.floor(nowMs - elapsedSecs * 1000));
}

function validateSessionIdentity(
  session: ClientSession,
): IdentityValidationResult {
  if (!session.isAuthenticated || !session.userId) {
    return {
      ok: false,
      reason: "authentication_required",
      message: "Authentication required",
    };
  }

  const canonicalUsername = session.username.trim();
  if (canonicalUsername.length === 0) {
    return {
      ok: false,
      reason: "invalid_user_profile",
      message: "Invalid user identity data",
    };
  }

  // Keep the active websocket session aligned with canonical user projection.
  session.username = canonicalUsername;

  const displayName =
    session.name && session.name.trim().length > 0
      ? session.name.trim()
      : canonicalUsername;

  session.name = displayName;

  return {
    ok: true,
    userId: session.userId,
    username: canonicalUsername,
    displayName,
  };
}

function cleanupClient(ws: WebSocket) {
  const session = clientSessions.get(ws);
  if (!session) return;
  const { roomId, peerId, userId, isAuthenticated, name } = session;

  clientSessions.delete(ws);

  const otherAuthenticatedSessions = userId
    ? Array.from(clientSessions.values()).filter(
        (s) => s.userId === userId && s.isAuthenticated,
      )
    : [];
  const hasOtherAuthenticatedSession = otherAuthenticatedSessions.length > 0;

  // Release authoritative user room lock only for the owning websocket.
  if (userId) {
    const lock = activeUserRoomLocks.get(userId);
    if (lock && lock.ws === ws) {
      const replacement =
        otherAuthenticatedSessions.find((s) => s.roomId === roomId) ||
        otherAuthenticatedSessions[0];
      if (replacement && replacement.roomId) {
        activeUserRoomLocks.set(userId, {
          roomId: replacement.roomId,
          ws: replacement.ws,
        });
      } else {
        activeUserRoomLocks.delete(userId);
      }
    }
  }

  // Broadcast user_offline only when the account has no remaining authenticated sockets.
  if (isAuthenticated && userId && !hasOtherAuthenticatedSession) {
    broadcastToAll("user_offline", {
      user_id: userId,
      username: name,
    });
    logInfo(`Broadcasting user_offline for user ${userId}`);
  }

  if (roomId && peerId !== null) {
    handleRoomDeparture(ws, session, otherAuthenticatedSessions, true);
  }
}

function handleRoomDeparture(
  ws: WebSocket,
  session: ClientSession,
  otherAuthenticatedSessions: ClientSession[],
  isSocketClosing: boolean,
): void {
  const { roomId, peerId, userId } = session;
  if (!roomId || peerId === null) {
    if (!isSocketClosing) {
      session.roomId = null;
      session.peerId = null;
    }
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    if (!isSocketClosing) {
      session.roomId = null;
      session.peerId = null;
    }
    return;
  }

  const leavingMember = room.clients.get(peerId);
  const wasHost = leavingMember?.isHost || false;

  roomManager.leaveRoom(roomId, peerId);

  if (userId) {
    const hasOtherSameUserInRoom = otherAuthenticatedSessions.some(
      (s) => s.roomId === roomId,
    );
    if (!hasOtherSameUserInRoom) {
      roomRepo.removePlayerSession(userId, roomId);
      console.log(
        `[WebSocket] 🚪 Player ${userId} left room ${roomId} (closing=${isSocketClosing})`,
      );
    } else {
      console.log(
        `[WebSocket] 🔒 Preserving player session for user ${userId} in room ${roomId} (another authenticated socket is still active in-room)`,
      );
    }
  }

  const remainingMembers = roomManager.getRoomMembers(roomId);
  if (wasHost && remainingMembers.length > 0) {
    const promoted = remainingMembers[0];
    promoted.isHost = true;
    room.hostPeerId = promoted.peerId;
    if (promoted.userId > 0) {
      roomRepo.updateRoomHost(roomId, promoted.userId, promoted.name);
    }
    console.log(
      `[WebSocket] 👑 Player ${promoted.name} promoted to host (previous host left)`,
    );
    broadcast(room, "host_changed", {
      newHostPeerId: promoted.peerId,
      newHostName: promoted.name,
    });
  }

  if (remainingMembers.length === 0) {
    roomRepo.setRoomActive(roomId, false);
    roomRepo.deleteRoom(roomId);
    console.log(
      `[WebSocket] 🗑️ Room ${roomId} has no users left; marked inactive and deleted`,
    );
  } else {
    broadcast(room, "peer_left", { peerId }, peerId);
    logInfo(`peer left: roomId=${roomId} peerId=${peerId}`);
  }

  if (!isSocketClosing) {
    session.roomId = null;
    session.peerId = null;
  }

  notifyAllClientsRoomsChanged();
  void syncRegistryRoomStateNow();
}

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server });

  if (!_matchTransferRetryLoopStarted) {
    _matchTransferRetryLoopStarted = true;
    setInterval(() => {
      void retryPendingRoomMatchTransfers();
    }, MATCH_TRANSFER_RETRY_INTERVAL_MS);
  }

  wss.on("connection", (ws: WebSocket) => {
    const ip = getClientIp(ws);
    const session: ClientSession = {
      ws,
      peerId: null,
      roomId: null,
      username: "",
      name: "",
      version: "",
      ip,
      userId: null,
      isAuthenticated: false,
      accessToken: null,
    };
    clientSessions.set(ws, session);
    logInfo(`ws: client connected from ${ip}`);

    ws.on("message", async (raw: RawData) => {
      const msg = validateJson(raw.toString());
      if (!msg) {
        return send(ws, "error", { reason: "bad_json" });
      }

      switch (msg.type) {
        case "handshake": {
          // Handle authentication with JWT token
          if (
            !msg.data ||
            typeof (msg.data as any).version !== "string" ||
            typeof (msg.data as any).name !== "string"
          ) {
            return send(ws, "error", { reason: "invalid_handshake" });
          }

          const token = (msg.data as any).token;
          if (token) {
            // Verify JWT token
            const user = await verifyTokenWithFallback(token);
            if (user) {
              session.userId = user.userId;
              session.isAuthenticated = true;
              session.accessToken = token;
              session.username = user.username;
              session.name =
                user.display_name && user.display_name.trim().length > 0
                  ? user.display_name
                  : user.username;
              logInfo(
                `authenticated user: userId=${user.userId} username=${session.username}`,
              );
            } else {
              return send(ws, "error", { reason: "invalid_token" });
            }
          } else {
            // Allow unauthenticated connections for classic mode
            session.name = (msg.data as any).name;
          }

          session.version = (msg.data as any).version;
          send(ws, "handshake_accepted", {
            peer_id: session.peerId || 0,
            user_id: session.userId,
            username: session.name,
          });
          logInfo(
            `handshake: name=${session.name} auth=${session.isAuthenticated}`,
          );

          // Broadcast user_online to all clients if authenticated
          if (session.isAuthenticated && session.userId) {
            broadcastToAll("user_online", {
              user_id: session.userId,
              username: session.name,
            });
            logInfo(`Broadcasting user_online for user ${session.userId}`);
          }

          break;
        }

        case "create_room": {
          // Require authentication for global mode
          const identity = validateSessionIdentity(session);
          if (!identity.ok) {
            return send(ws, "error", {
              reason: identity.reason,
              message: identity.message,
            });
          }

          // For global mode, the room should already exist from HTTP POST
          // Check if user already has a room
          const existingRoom = roomRepo.getUserActiveRoomStrict(
            identity.userId,
          );

          if (!existingRoom) {
            return send(ws, "error", {
              reason: "no_room_found",
              message: "Room must be created via HTTP POST /api/rooms first",
            });
          }

          const existingLock = activeUserRoomLocks.get(identity.userId);
          if (existingLock && existingLock.ws !== ws) {
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: existingLock.roomId,
              message:
                "This account is already active in a room from another device/session. Leave that room first.",
            });
          }

          if (session.roomId && session.roomId !== existingRoom.id) {
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: session.roomId,
              message:
                "This account is already active in another room. Leave it first before switching.",
            });
          }

          // Use the existing room from database
          const roomId = existingRoom.id;

          // Create room in memory if it doesn't exist yet
          let room = roomManager.getRoom(roomId);
          if (!room) {
            room = roomManager.createRoomWithId(
              roomId,
              session.version,
              identity.displayName,
              ip,
            );
          }

          // Ensure host is present in-memory for identity-based duplicate checks.
          const existingHostMember = Array.from(room.clients.values()).find(
            (client) => client.userId === identity.userId,
          );
          let hostPeerId = 1;
          if (existingHostMember) {
            hostPeerId = existingHostMember.peerId;
            existingHostMember.isHost = true;
            existingHostMember.name = identity.displayName;
            existingHostMember.version = session.version;
            room.hostPeerId = hostPeerId;
          } else {
            room.clients.set(1, {
              peerId: 1,
              userId: identity.userId,
              name: identity.displayName,
              version: session.version,
              isHost: true,
            });
            room.hostPeerId = 1;
            room.nextPeerId = Math.max(room.nextPeerId, 2);
          }

          // Persist host session so cross-device checks are DB-authoritative.
          const hostSessionResult = roomRepo.addPlayerSession(
            identity.userId,
            roomId,
          );
          if (!hostSessionResult.ok) {
            if (hostSessionResult.reason === "user_already_in_other_room") {
              return send(ws, "error", {
                reason: "user_already_in_room",
                existingRoomId: hostSessionResult.existingRoomId,
                message:
                  "This account is already active in another room. Leave that room first before creating/confirming a room from this device.",
              });
            }

            if (hostSessionResult.reason === "database_error") {
              return send(ws, "error", {
                reason: "player_session_error",
                message:
                  "Unable to confirm room host session right now. Please try again.",
              });
            }
          }

          // Host session is now persisted here (WebSocket confirmation).
          // Update connection session and respond.
          console.log(
            `[WebSocket] 👑 Host ${identity.userId} (${identity.username}) confirming room ${roomId}`,
          );

          session.peerId = hostPeerId;
          session.roomId = roomId;
          session.username = identity.username;
          session.name = identity.displayName;
          activeUserRoomLocks.set(identity.userId, { roomId, ws });

          // Host confirmation updates room membership count/state.
          notifyAllClientsRoomsChanged();
          void syncRegistryRoomStateNow();

          send(ws, "room_created", {
            roomId: roomId,
            peerId: hostPeerId,
            gamemode: existingRoom.gamemode,
            mapName: existingRoom.map_name,
          });
          logInfo(
            `room created: roomId=${roomId} gamemode=${existingRoom.gamemode} host=${session.name}`,
          );
          break;
        }

        case "join_room": {
          // Require authentication for global mode
          const identity = validateSessionIdentity(session);
          if (!identity.ok) {
            return send(ws, "error", {
              reason: identity.reason,
              message: identity.message,
            });
          }

          if (
            !msg.data ||
            typeof (msg.data as any).roomId !== "string" ||
            typeof (msg.data as any).version !== "string"
          ) {
            console.log(`[WebSocket] ❌ join_room: Invalid data format`);
            return send(ws, "error", { reason: "invalid_join_room" });
          }

          const roomId = (msg.data as any).roomId;
          const version = (msg.data as any).version;
          const playerName = identity.displayName;
          session.username = identity.username;
          session.name = playerName;

          // Acquire/refresh per-user lock BEFORE expensive join work to block cross-device races.
          const existingLock = activeUserRoomLocks.get(identity.userId);
          if (existingLock && existingLock.ws !== ws) {
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: existingLock.roomId,
              message:
                "This account is already active in a room from another device/session. Leave that room first.",
            });
          }
          activeUserRoomLocks.set(identity.userId, { roomId, ws });
          const releaseJoinLock = () => {
            const lock = activeUserRoomLocks.get(identity.userId);
            if (lock && lock.ws === ws && session.roomId !== lock.roomId) {
              activeUserRoomLocks.delete(identity.userId);
            }
          };

          // Authoritative identity check: block only if user is active in a DIFFERENT room.
          const conflictingRoom = roomRepo.getUserConflictingActiveRoom(
            identity.userId,
            roomId,
          );
          if (conflictingRoom) {
            releaseJoinLock();
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: conflictingRoom.id,
              message:
                "This account is already active in another room. Leave that room first before joining.",
            });
          }

          // Security lock: one authenticated user can be in only one active room
          // across all websocket sessions/devices.
          if (session.roomId && session.roomId !== roomId) {
            releaseJoinLock();
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: session.roomId,
              message:
                "This account is already active in another room. Leave it first before joining a different room.",
            });
          }

          const otherSessionInRoom = Array.from(clientSessions.values()).find(
            (s) =>
              s.ws !== ws &&
              s.userId === identity.userId &&
              s.isAuthenticated &&
              s.roomId !== null,
          );
          if (otherSessionInRoom) {
            releaseJoinLock();
            return send(ws, "error", {
              reason: "user_already_in_room",
              existingRoomId: otherSessionInRoom.roomId,
              message:
                "This account is already active in a room from another device/session. Leave that room first before joining.",
            });
          }

          console.log(
            `[WebSocket] 📥 join_room request: user=${identity.userId} username=${identity.username} room=${roomId} display=${playerName}`,
          );

          // Never allow joins into inactive/missing rooms.
          const dbRoom = roomRepo.getRoomById(roomId);
          if (!dbRoom) {
            releaseJoinLock();
            return send(ws, "error", { reason: "room_not_found" });
          }
          if (!dbRoom.is_active) {
            releaseJoinLock();
            return send(ws, "error", {
              reason: "room_inactive",
              message: "Room is inactive and can no longer be joined.",
            });
          }

          // Check if room exists in memory; if not, try to load from database
          let room = roomManager.getRoom(roomId);
          if (!room) {
            // Room not in memory yet; create it from database info
            // Create room in memory with info from database
            room = roomManager.createRoomWithId(
              roomId,
              version,
              dbRoom.host_username,
              ip,
            );
            console.log(
              `[WebSocket] 📂 Loaded room ${roomId} from database into memory`,
            );
          }

          const result = roomManager.joinRoom(
            roomId,
            version,
            identity.userId,
            playerName,
            ip,
          );
          if ("error" in result) {
            console.log(
              `[WebSocket] ❌ join_room: RoomManager error - ${result.error}`,
            );
            releaseJoinLock();
            return send(ws, "error", { reason: result.error });
          }
          const { room: updatedRoom, peerId } = result;

          // Add player to room session (enforces single-room, increments player count)
          const sessionResult = roomRepo.addPlayerSession(
            identity.userId,
            roomId,
          );
          if (!sessionResult.ok) {
            if (sessionResult.reason === "user_already_in_target_room") {
              const existingRoomId = sessionResult.existingRoomId;
              const otherLiveInRoomSession = Array.from(
                clientSessions.values(),
              ).find(
                (s) =>
                  s.ws !== ws &&
                  s.userId === identity.userId &&
                  s.isAuthenticated &&
                  s.roomId === roomId,
              );
              if (otherLiveInRoomSession) {
                // True concurrent session in the same room -> block.
                roomManager.leaveRoom(roomId, peerId);
                console.log(
                  `[WebSocket] ⛔ Blocking concurrent same-room session for user ${identity.userId} in ${existingRoomId}`,
                );
                releaseJoinLock();
                return send(ws, "error", {
                  reason: "user_already_in_room",
                  existingRoomId,
                  message: `This account is already active in room ${existingRoomId}. Leave that room first before joining from another device.`,
                });
              }

              // Idempotent reconnect: DB row already exists for this user+room, but no other live room session.
              console.log(
                `[WebSocket] 🔁 Allowing idempotent same-room reconnect for user ${identity.userId} in ${existingRoomId}`,
              );
            } else if (sessionResult.reason === "user_already_in_other_room") {
              // Roll back in-memory room membership because user is active elsewhere.
              roomManager.leaveRoom(roomId, peerId);
              const existingRoomId = sessionResult.existingRoomId;
              console.log(
                `[WebSocket] ⛔ Blocking duplicate login for user ${identity.userId}; active in ${existingRoomId}`,
              );
              releaseJoinLock();
              return send(ws, "error", {
                reason: "user_already_in_room",
                existingRoomId,
                message: `This account is already active in another room (${existingRoomId}). Leave that room first before joining from another device.`,
              });
            } else {
              // database_error
              roomManager.leaveRoom(roomId, peerId);
              releaseJoinLock();
              return send(ws, "error", {
                reason: "player_session_error",
                message: "Unable to join room right now. Please try again.",
              });
            }

            // For user_already_in_target_room reconnect path, continue and attach websocket session.
          }

          // Commit websocket session state only after DB/session lock succeeds.
          session.peerId = peerId;
          session.name = playerName;
          session.username = identity.username;
          session.version = version;
          session.roomId = roomId;
          activeUserRoomLocks.set(identity.userId, { roomId, ws });

          console.log(
            `[WebSocket] 🎮 Player ${identity.userId} (${identity.username}) joined room ${roomId}`,
          );

          // Check if room was empty and promote this player to host
          const memberCount = roomManager.getRoomMembers(roomId).length;
          if (memberCount === 1) {
            // This is the first player joining - make them the host
            const updatedMember = roomManager.getRoomMembers(roomId)[0];
            updatedMember.isHost = true;
            room.hostPeerId = updatedMember.peerId;
            roomRepo.updateRoomHost(
              roomId,
              identity.userId,
              identity.displayName,
            );
            console.log(
              `[WebSocket] 👑 Player ${identity.userId} promoted to host (first member in empty room)`,
            );
          }

          // Player count already updated by addPlayerSession, no need to update again

          const members = roomManager.getRoomMembers(roomId);
          const chatHistory = roomRepo.getRecentRoomChatMessages(roomId, 100);
          const dbActiveGamemode: ActiveGamemodePayload | null =
            parseDbActiveGamemode(dbRoom);
          const activeGamemodePayload: ActiveGamemodePayload | null =
            dbActiveGamemode !== null
              ? dbActiveGamemode
              : updatedRoom.activeGamemode === null
                ? null
                : {
                    index: updatedRoom.activeGamemode.index,
                    params: updatedRoom.activeGamemode.params,
                    mods: updatedRoom.activeGamemode.mods,
                    startedAtMs: updatedRoom.activeGamemode.startedAtMs,
                    remainingSecs: calculateRemainingSecs(
                      updatedRoom.activeGamemode.startedAtMs,
                      updatedRoom.activeGamemode.params,
                    ),
                  };
          const selectedGamemodePayload: SelectedGamemodePayload | null =
            parseDbSelectedGamemode(dbRoom);
          console.log(
            `[WebSocket] 👥 Room ${roomId} members:`,
            members.map((m) => `peer=${m.peerId} name=${m.name}`),
          );

          // Player count/state may have changed due to successful join.
          notifyAllClientsRoomsChanged();
          void syncRegistryRoomStateNow();

          send(ws, "room_joined", {
            roomId: roomId,
            peerId,
            members: members.map((c) => ({
              peerId: c.peerId,
              name: c.name,
              isHost: c.isHost,
            })),
            gamemode: dbRoom?.gamemode || "Deathmatch",
            mapName: dbRoom?.map_name || "Frozen Field",
            currentTbw: updatedRoom.currentTbw,
            activeGamemode: activeGamemodePayload,
            selectedGamemode: selectedGamemodePayload,
            chatHistory: chatHistory.map((entry) => ({
              from: entry.sender_peer_id ?? 0,
              fromName: entry.sender_name,
              text: entry.message,
              createdAt: entry.created_at,
            })),
          });

          console.log(
            `[WebSocket] 📢 Broadcasting peer_joined to room: peerId=${peerId} name=${session.name}`,
          );
          broadcast(
            updatedRoom,
            "peer_joined",
            { peerId, name: session.name },
            peerId,
          );
          logInfo(
            `peer joined: roomId=${roomId} peerId=${peerId} name=${session.name}`,
          );
          break;
        }

        case "leave_room": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "left_room", { roomId: null, peerId: null });
          }

          const otherAuthenticatedSessions = session.userId
            ? Array.from(clientSessions.values()).filter(
                (s) =>
                  s.ws !== ws &&
                  s.userId === session.userId &&
                  s.isAuthenticated,
              )
            : [];

          handleRoomDeparture(ws, session, otherAuthenticatedSessions, false);

          if (session.userId) {
            const lock = activeUserRoomLocks.get(session.userId);
            if (lock && lock.ws === ws) {
              const replacement = otherAuthenticatedSessions[0];
              if (replacement && replacement.roomId) {
                activeUserRoomLocks.set(session.userId, {
                  roomId: replacement.roomId,
                  ws: replacement.ws,
                });
              } else {
                activeUserRoomLocks.delete(session.userId);
              }
            }
          }

          send(ws, "left_room", { roomId: null, peerId: null });
          break;
        }

        case "chat": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });
          const textRaw =
            typeof (msg.data as any)?.text === "string"
              ? (msg.data as any).text.slice(0, 500)
              : "";
          const text = textRaw.trim();
          if (text.length === 0) {
            return;
          }

          roomRepo.addRoomChatMessage({
            roomId: room.id,
            senderUserId: session.userId,
            senderPeerId: session.peerId,
            senderName: session.name,
            message: text,
          });

          broadcast(room, "chat", {
            from: session.peerId,
            fromName: session.name,
            text,
          });
          logInfo(
            `chat: roomId=${room.id} peerId=${session.peerId} msg=${text.slice(
              0,
              50,
            )}`,
          );
          break;
        }

        case "load_tbw": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });
          if (!room.clients.get(session.peerId)?.isHost) {
            return send(ws, "error", { reason: "not_host" });
          }
          const lines = Array.isArray((msg.data as any)?.lines)
            ? (msg.data as any).lines.slice(0, 200000)
            : [];
          roomManager.updateTbw(room.id, lines);
          broadcast(room, "tbw", { lines });
          logInfo(`tbw broadcast: roomId=${room.id} lines=${lines.length}`);
          break;
        }

        case "player_snapshot": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });
          broadcast(
            room,
            "player_snapshot",
            {
              from: session.peerId,
              payload: (msg.data as any)?.payload ?? {},
            },
            session.peerId,
          );
          break;
        }

        case "player_state": {
          // Relay player state (position, rotation, velocity) to all other clients
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });

          const stateData = (msg.data as any) || {};
          broadcast(
            room,
            "player_state",
            {
              peerId: session.peerId,
              position: stateData.position || { x: 0, y: 0, z: 0 },
              rotation: stateData.rotation || { x: 0, y: 0, z: 0 },
              velocity: stateData.velocity || { x: 0, y: 0, z: 0 },
              // Pass through animation and state so clients can fully sync visuals
              state: stateData.state ?? 0,
              anim: stateData.anim || {},
            },
            session.peerId,
          );
          break;
        }

        case "kick": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });
          if (!room.clients.get(session.peerId)?.isHost) {
            return send(ws, "error", { reason: "not_host" });
          }
          const targetPeerId = (msg.data as any)?.peerId;
          if (typeof targetPeerId !== "number") {
            return send(ws, "error", { reason: "invalid_target" });
          }
          const targetSession = Array.from(clientSessions.values()).find(
            (s) => s.roomId === room.id && s.peerId === targetPeerId,
          );
          if (targetSession) {
            send(targetSession.ws, "kicked", { reason: "host_kick" });
            cleanupClient(targetSession.ws);
          }
          logInfo(`kick: roomId=${room.id} target=${targetPeerId}`);
          break;
        }

        case "ban": {
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });
          if (!room.clients.get(session.peerId)?.isHost) {
            return send(ws, "error", { reason: "not_host" });
          }
          const targetIp = (msg.data as any)?.ip;
          if (typeof targetIp !== "string") {
            return send(ws, "error", { reason: "invalid_target" });
          }
          roomManager.banPlayer(room.id, targetIp);
          logInfo(`ban: roomId=${room.id} ip=${targetIp}`);
          break;
        }

        case "ping": {
          send(ws, "pong", { ts: Date.now() });
          break;
        }

        case "match_result": {
          const identity = validateSessionIdentity(session);
          if (!identity.ok || !session.accessToken) {
            return send(ws, "error", {
              reason: "authentication_required",
              message:
                "Authenticated host session required for match reporting",
            });
          }

          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }

          const room = roomManager.getRoom(session.roomId);
          if (!room) {
            return send(ws, "error", { reason: "room_not_found" });
          }

          if (!room.clients.get(session.peerId)?.isHost) {
            return send(ws, "error", {
              reason: "not_host",
              message: "Only room host can submit match results",
            });
          }

          const payload = (msg.data as any) || {};
          const gamemode =
            typeof payload.gamemode === "string" &&
            payload.gamemode.trim().length > 0
              ? payload.gamemode.trim()
              : "unknown";

          const winnerRaw = payload.winner_user_id ?? payload.winnerUserId;
          const winnerUserId =
            typeof winnerRaw === "number"
              ? winnerRaw
              : typeof winnerRaw === "string"
                ? Number.parseInt(winnerRaw, 10)
                : null;

          const durationRaw =
            payload.duration_seconds ?? payload.durationSeconds;
          const durationSeconds =
            typeof durationRaw === "number"
              ? Math.max(0, Math.floor(durationRaw))
              : typeof durationRaw === "string"
                ? Math.max(0, Number.parseInt(durationRaw, 10) || 0)
                : 0;

          const sourcePlayers = Array.isArray(payload.players)
            ? payload.players
            : [];
          const players: MatchPlayerReport[] = sourcePlayers
            .map((entry: any) => {
              const userIdRaw = entry?.user_id ?? entry?.userId;
              const parsedUserId =
                typeof userIdRaw === "number"
                  ? userIdRaw
                  : typeof userIdRaw === "string"
                    ? Number.parseInt(userIdRaw, 10)
                    : NaN;

              if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
                return null;
              }

              const kills = Number.parseInt(String(entry?.kills ?? 0), 10) || 0;
              const deaths =
                Number.parseInt(String(entry?.deaths ?? 0), 10) || 0;
              const playtimeSeconds =
                Number.parseInt(
                  String(
                    entry?.playtime_seconds ?? entry?.playtimeSeconds ?? 0,
                  ),
                  10,
                ) || 0;

              return {
                user_id: parsedUserId,
                kills: Math.max(0, kills),
                deaths: Math.max(0, deaths),
                playtime_seconds: Math.max(0, playtimeSeconds),
                won: Boolean(entry?.won),
              } satisfies MatchPlayerReport;
            })
            .filter(
              (entry: MatchPlayerReport | null): entry is MatchPlayerReport =>
                entry !== null,
            );

          if (players.length === 0) {
            return send(ws, "error", {
              reason: "invalid_match_result",
              message: "players array must include at least one valid user_id",
            });
          }

          const localMatchHistoryId = roomRepo.addRoomMatchHistory({
            roomId: session.roomId,
            gamemode,
            winnerUserId:
              winnerUserId && Number.isInteger(winnerUserId) && winnerUserId > 0
                ? winnerUserId
                : null,
            durationSeconds,
          });
          roomRepo.addRoomMatchParticipants(localMatchHistoryId, players);

          reportMatchToDjango(session.accessToken, {
            room_id: session.roomId,
            gamemode,
            winner_user_id:
              winnerUserId && Number.isInteger(winnerUserId) && winnerUserId > 0
                ? winnerUserId
                : null,
            duration_seconds: durationSeconds,
            players,
          })
            .then((result) => {
              roomRepo.markRoomMatchHistoryTransferred(
                localMatchHistoryId,
                typeof result.match_id === "number" ? result.match_id : null,
              );
              send(ws, "match_result_saved", {
                roomId: session.roomId,
                matchId: result.match_id ?? null,
                processedPlayers: result.processed_players ?? players.length,
              });
              logInfo(
                `match_result persisted: roomId=${session.roomId} matchId=${result.match_id ?? "n/a"} players=${players.length}`,
              );
            })
            .catch((err: unknown) => {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              roomRepo.markRoomMatchHistoryTransferFailed(
                localMatchHistoryId,
                errorMessage,
              );
              logWarning(
                `match_result persistence failed for roomId=${session.roomId}: ${errorMessage}`,
              );
              send(ws, "match_result_error", {
                roomId: session.roomId,
                message: "Failed to persist match result",
              });
            });

          break;
        }

        case "rpc_call": {
          // Handle RPC calls - relay to target peer(s)
          if (!session.roomId || session.peerId === null) {
            return send(ws, "error", { reason: "not_in_room" });
          }
          const room = roomManager.getRoom(session.roomId);
          if (!room) return send(ws, "error", { reason: "room_not_found" });

          const targetPeer = (msg.data as any)?.targetPeer || 0;
          const method = (msg.data as any)?.method || "";
          const args = (msg.data as any)?.args || [];

          const rpcData = {
            fromPeer: session.peerId,
            method,
            args,
          };

          const sender = room.clients.get(session.peerId);
          const senderIsHost = Boolean(sender?.isHost);
          if (method === "remote_start_gamemode" && senderIsHost) {
            const idxRaw = Array.isArray(args) ? args[0] : undefined;
            const paramsRaw = Array.isArray(args) ? args[1] : [];
            const modsRaw = Array.isArray(args) ? args[2] : [];
            const startedRaw = Array.isArray(args) ? args[3] : 0;
            const idx =
              typeof idxRaw === "number"
                ? Math.max(0, Math.floor(idxRaw))
                : Number.parseInt(String(idxRaw ?? 0), 10) || 0;
            const startedAtMs =
              typeof startedRaw === "number"
                ? Math.max(0, Math.floor(startedRaw))
                : Number.parseInt(String(startedRaw ?? 0), 10) || Date.now();
            roomManager.setActiveGamemode(
              room.id,
              idx,
              Array.isArray(paramsRaw) ? paramsRaw : [],
              Array.isArray(modsRaw) ? modsRaw : [],
              startedAtMs,
            );
            roomRepo.setActiveGamemodeState(
              room.id,
              idx,
              Array.isArray(paramsRaw) ? paramsRaw : [],
              Array.isArray(modsRaw) ? modsRaw : [],
              startedAtMs,
              totalGamemodeSecondsFromParams(
                Array.isArray(paramsRaw) ? paramsRaw : [],
              ),
            );
          } else if (method === "remote_end_gamemode" && senderIsHost) {
            const active = room.activeGamemode;
            if (active !== null) {
              const startedAtMs = toSafeMs(active.startedAtMs);
              const endedAtMs = Date.now();
              const durationSeconds = Math.max(
                0,
                Math.floor((endedAtMs - startedAtMs) / 1000),
              );
              roomRepo.addRoomGamemodeHistory({
                roomId: room.id,
                gamemodeIndex: active.index,
                params: Array.isArray(active.params) ? active.params : [],
                mods: Array.isArray(active.mods) ? active.mods : [],
                timerSeconds: totalGamemodeSecondsFromParams(
                  Array.isArray(active.params) ? active.params : [],
                ),
                startedAtMs,
                endedAtMs,
                durationSeconds,
              });
            }
            roomManager.clearActiveGamemode(room.id);
            roomRepo.clearActiveGamemodeState(room.id);
          } else if (method === "remote_gamemode_timer_sync" && senderIsHost) {
            const remainingRaw = Array.isArray(args) ? args[1] : undefined;
            const totalRaw = Array.isArray(args) ? args[2] : undefined;
            const startedAtMs = recalculateStartedAtFromTimer(
              Date.now(),
              remainingRaw,
              totalRaw,
            );
            if (startedAtMs !== null) {
              const active = room.activeGamemode;
              if (active !== null) {
                roomManager.setActiveGamemode(
                  room.id,
                  active.index,
                  Array.isArray(active.params) ? active.params : [],
                  Array.isArray(active.mods) ? active.mods : [],
                  startedAtMs,
                );
                roomRepo.setActiveGamemodeState(
                  room.id,
                  active.index,
                  Array.isArray(active.params) ? active.params : [],
                  Array.isArray(active.mods) ? active.mods : [],
                  startedAtMs,
                  Math.max(1, Math.ceil(parseNumber(remainingRaw, 0))),
                );
              }
            }
          } else if (method === "remote_gamemode_menu_sync" && senderIsHost) {
            const idxRaw = Array.isArray(args) ? args[0] : undefined;
            const paramsRaw = Array.isArray(args) ? args[1] : [];
            const modsRaw = Array.isArray(args) ? args[2] : [];
            const idx =
              typeof idxRaw === "number"
                ? Math.max(0, Math.floor(idxRaw))
                : Number.parseInt(String(idxRaw ?? 0), 10) || 0;
            roomRepo.setSelectedGamemodeState(
              room.id,
              idx,
              Array.isArray(paramsRaw) ? paramsRaw : [],
              Array.isArray(modsRaw) ? modsRaw : [],
            );
          }

          if (
            method === "remote_tool_active" ||
            method === "remote_fire_visual"
          ) {
            logInfo(
              `[WS] 🔧 rpc_call ${method} from peer ${session.peerId} to ${targetPeer === 0 ? "ALL" : targetPeer}, args: ${JSON.stringify(args)}`,
            );
          }

          if (targetPeer === 0) {
            // Broadcast to all peers in room
            const recipientCount = room.clients.size - 1; // exclude sender
            if (
              method === "remote_tool_active" ||
              method === "remote_fire_visual"
            ) {
              logInfo(
                `[WS] 📢 Broadcasting ${method} to ${recipientCount} peers (excluding ${session.peerId})`,
              );
            }
            broadcast(room, "rpc_call", rpcData, session.peerId);
          } else {
            // Send to specific peer
            const targetSession = Array.from(clientSessions.values()).find(
              (s) => s.roomId === room.id && s.peerId === targetPeer,
            );
            if (targetSession) {
              send(targetSession.ws, "rpc_call", rpcData);
            }
          }
          break;
        }

        default:
          send(ws, "error", { reason: "unknown_type" });
      }
    });

    ws.on("close", () => {
      cleanupClient(ws);
      logInfo(`ws: client disconnected from ${ip}`);
    });

    ws.on("error", (error: Error) => {
      logError(`ws error from ${ip}: ${error.message}`);
      cleanupClient(ws);
    });
  });

  wss.on("error", (error: Error) => {
    logError(`wss error: ${error.message}`);
  });

  return wss;
}

// Export broadcast function for use in other modules
export function notifyAllClientsRoomsChanged() {
  broadcastToAll("rooms_changed", {});
}
