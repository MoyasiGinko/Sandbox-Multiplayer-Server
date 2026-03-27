/**
 * ENet support is not implemented in this external server.
 * This server is WebSocket-only and designed to coexist with Godot's built-in ENet.
 *
 * To add ENet support, use a native binding like enet-node or implement
 * a protocol bridge that emits the same messages as websocket.ts.
 *
 * For now, this stub is here to avoid import errors during development.
 */

export function setupENet() {
  console.log("ENet: not implemented (WebSocket-only)");
}
