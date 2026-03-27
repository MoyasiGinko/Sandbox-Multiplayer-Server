import { describe, it, expect, beforeEach } from "@jest/globals";
import { RoomManager } from "../../src/game/roomManager";

describe("RoomManager", () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  it("should create a room with host as peer 1", () => {
    const room = manager.createRoom("1.0.0", "TestHost", "127.0.0.1");
    expect(room.id).toBeDefined();
    expect(room.hostPeerId).toBe(1);
    expect(room.version).toBe("1.0.0");
    expect(room.clients.has(1)).toBe(true);
    expect(room.clients.get(1)?.name).toBe("TestHost");
  });

  it("should reject join if room not found", () => {
    const result = manager.joinRoom(
      "nonexistent",
      "1.0.0",
      "Player1",
      "127.0.0.1"
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("room_not_found");
    }
  });

  it("should reject join if version mismatch", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    const result = manager.joinRoom(room.id, "2.0.0", "Player1", "127.0.0.1");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("version_mismatch");
    }
  });

  it("should reject join if name is taken", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    const result1 = manager.joinRoom(room.id, "1.0.0", "Player1", "127.0.0.1");
    expect("peerId" in result1).toBe(true);

    const result2 = manager.joinRoom(
      room.id,
      "1.0.0",
      "Player1",
      "192.168.1.1"
    );
    expect("error" in result2).toBe(true);
    if ("error" in result2) {
      expect(result2.error).toBe("name_taken");
    }
  });

  it("should accept valid join and assign next peerId", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    const result = manager.joinRoom(room.id, "1.0.0", "Player1", "192.168.1.1");
    expect("peerId" in result).toBe(true);
    if ("peerId" in result) {
      expect(result.peerId).toBe(2);
      expect(result.room.clients.has(2)).toBe(true);
    }
  });

  it("should remove room when last peer leaves", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    expect(manager.getRoom(room.id)).toBeDefined();
    manager.leaveRoom(room.id, 1);
    expect(manager.getRoom(room.id)).toBeUndefined();
  });

  it("should update TBW lines", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    const lines = ["[tbw]", "version ; 13020", "gravity_scale ; 1.5"];
    manager.updateTbw(room.id, lines);
    const updated = manager.getRoom(room.id);
    expect(updated?.currentTbw).toEqual(lines);
  });

  it("should track banned IPs", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    manager.banPlayer(room.id, "192.168.1.99");
    const result = manager.joinRoom(room.id, "1.0.0", "Player", "192.168.1.99");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("banned");
    }
  });

  it("should return room members", () => {
    const room = manager.createRoom("1.0.0", "Host", "127.0.0.1");
    const j1 = manager.joinRoom(room.id, "1.0.0", "P1", "192.168.1.1");
    const j2 = manager.joinRoom(room.id, "1.0.0", "P2", "192.168.1.2");

    if ("peerId" in j1 && "peerId" in j2) {
      const members = manager.getRoomMembers(room.id);
      expect(members.length).toBe(3);
      expect(members.find((m: any) => m.name === "Host")).toBeDefined();
      expect(members.find((m: any) => m.name === "P1")).toBeDefined();
      expect(members.find((m: any) => m.name === "P2")).toBeDefined();
    }
  });
});
