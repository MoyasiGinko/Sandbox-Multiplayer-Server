import { nanoid } from "nanoid";

export interface RoomClient {
  peerId: number;
  userId: number;
  name: string;
  version: string;
  isHost: boolean;
}

export interface GameRoom {
  id: string;
  hostPeerId: number;
  version: string;
  clients: Map<number, RoomClient>;
  nextPeerId: number;
  currentTbw: string[];
  bannedIps: Set<string>;
  activeGamemode: {
    index: number;
    params: unknown[];
    mods: unknown[];
    startedAtMs: number;
  } | null;
}

export class RoomManager {
  private rooms: Map<string, GameRoom>;

  constructor() {
    this.rooms = new Map();
  }

  createRoom(
    version: string,
    hostName: string,
    hostUserIdOrIp: number | string,
    _hostIpMaybe?: string,
  ): GameRoom {
    const hostUserId = typeof hostUserIdOrIp === "number" ? hostUserIdOrIp : -1;
    const roomId = nanoid(6);
    const room: GameRoom = {
      id: roomId,
      hostPeerId: 1,
      version,
      clients: new Map(),
      nextPeerId: 2,
      currentTbw: [],
      bannedIps: new Set(),
      activeGamemode: null,
    };
    room.clients.set(1, {
      peerId: 1,
      userId: hostUserId,
      name: hostName,
      version,
      isHost: true,
    });
    this.rooms.set(roomId, room);
    return room;
  }

  createRoomWithId(
    roomId: string,
    version: string,
    _hostName: string,
    _hostIp: string,
  ): GameRoom {
    const room: GameRoom = {
      id: roomId,
      hostPeerId: 1,
      version,
      clients: new Map(),
      nextPeerId: 1, // Start at 1 so first joiner gets peerId=1
      currentTbw: [],
      bannedIps: new Set(),
      activeGamemode: null,
    };
    // Don't add phantom host - let first joiner become host with peerId=1
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  joinRoom(
    roomId: string,
    version: string,
    userIdOrName: number | string,
    playerNameOrIp: string,
    clientIpMaybe?: string,
  ): { room: GameRoom; peerId: number } | { error: string } {
    const userId = typeof userIdOrName === "number" ? userIdOrName : -1;
    const playerName =
      typeof userIdOrName === "number" ? playerNameOrIp : userIdOrName;
    const clientIp =
      typeof userIdOrName === "number"
        ? (clientIpMaybe ?? "unknown")
        : playerNameOrIp;
    const room = this.rooms.get(roomId);
    if (!room) return { error: "room_not_found" };
    if (room.version !== version) return { error: "version_mismatch" };
    if (room.bannedIps.has(clientIp)) return { error: "banned" };

    // Security-critical: uniqueness must be based on immutable user identity.
    if (userId > 0) {
      for (const client of room.clients.values()) {
        if (client.userId === userId) {
          return { error: "user_already_in_room" };
        }
      }
    } else {
      // Backward compatibility for non-auth/test callers.
      for (const client of room.clients.values()) {
        if (client.name.toLowerCase() === playerName.toLowerCase()) {
          return { error: "name_taken" };
        }
      }
    }

    const peerId = room.nextPeerId++;
    room.clients.set(peerId, {
      peerId,
      userId,
      name: playerName,
      version,
      isHost: false,
    });
    return { room, peerId };
  }

  leaveRoom(roomId: string, peerId: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.clients.delete(peerId);
    if (room.clients.size === 0) {
      this.deleteRoom(roomId);
    }
  }

  banPlayer(roomId: string, playerIp: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.bannedIps.add(playerIp);
    }
  }

  updateTbw(roomId: string, lines: string[]): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.currentTbw = lines;
    }
  }

  setActiveGamemode(
    roomId: string,
    index: number,
    params: unknown[],
    mods: unknown[],
    startedAtMs: number,
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.activeGamemode = {
      index,
      params,
      mods,
      startedAtMs,
    };
  }

  clearActiveGamemode(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.activeGamemode = null;
  }

  getRoomMembers(roomId: string): RoomClient[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.clients.values());
  }
}
