/**
 * Godot Client Adapter Interface
 *
 * Maps Node server messages to Godot RPC calls while preserving peer IDs (server=1)
 * and maintaining authority semantics. This adapter is used in a custom
 * MultiplayerPeer bridge in the Godot client.
 */

export interface GodotAdapterMessage {
  type: "rpc" | "sync" | "state" | "error";
  peerId?: number;
  method?: string;
  args?: unknown[];
  data?: unknown;
  reason?: string;
}

/**
 * Message mapping from Node server to Godot RPC calls:
 *
 * room_created -> trigger RPC/signal with server details (peerId=1)
 * room_joined -> trigger RPC with room members and current world state
 * peer_joined -> broadcast "announce_player_joined" (Godot-native RPC)
 * peer_left -> remove player from world
 * chat -> broadcast via CommandHandler.submit_command RPC
 * tbw -> trigger ask_server_to_open_tbw RPC flow (World.gd)
 * player_snapshot -> sync_properties RPC per TBWObject
 * kicked -> disconnect and show alert
 * error -> show UIHandler.show_alert
 */

export class GodotClientAdapter {
  /**
   * Convert Node room_created into Godot handshake.
   * Host (peerId=1) sees room_created with roomId.
   */
  static roomCreated(roomId: string, peerId: number): GodotAdapterMessage {
    return {
      type: "state",
      peerId,
      data: { roomId, peerId, isHost: peerId === 1 },
    };
  }

  /**
   * Convert Node room_joined into Godot peer_connected signal.
   * Send to each joining client: peerId, members list, current TBW.
   */
  static roomJoined(
    roomId: string,
    peerId: number,
    members: { peerId: number; name: string; isHost: boolean }[],
    currentTbw: string[]
  ): GodotAdapterMessage {
    return {
      type: "state",
      peerId,
      data: {
        roomId,
        peerId,
        members,
        currentTbw,
      },
    };
  }

  /**
   * Convert Node peer_joined into Godot RPC broadcast.
   * All peers should call announce_player_joined with the new peer's name.
   */
  static peerJoined(peerId: number, name: string): GodotAdapterMessage {
    return {
      type: "rpc",
      peerId: 1, // from server
      method: "announce_player_joined",
      args: [name],
    };
  }

  /**
   * Convert Node chat into CommandHandler.submit_command RPC.
   */
  static chatMessage(
    peerId: number,
    fromName: string,
    text: string
  ): GodotAdapterMessage {
    return {
      type: "rpc",
      peerId: 1, // from server
      method: "submit_command",
      args: ["Chat", `${fromName}: ${text}`],
    };
  }

  /**
   * Convert Node tbw into ask_server_to_open_tbw RPC.
   * Host (peerId=1) loads TBW; server fans out to peers.
   */
  static tbwBroadcast(lines: string[]): GodotAdapterMessage {
    return {
      type: "rpc",
      peerId: 1, // from server
      method: "ask_server_to_open_tbw",
      args: ["External Server", "world", lines],
    };
  }

  /**
   * Convert Node player_snapshot into sync_properties or player state update.
   */
  static playerSnapshot(
    fromPeerId: number,
    payload: unknown
  ): GodotAdapterMessage {
    return {
      type: "sync",
      peerId: fromPeerId,
      data: payload,
    };
  }

  /**
   * Error or kick message.
   */
  static error(reason: string, details?: unknown): GodotAdapterMessage {
    return {
      type: "error",
      reason,
      data: details,
    };
  }
}
