# Backend Game Server

## Overview

This project is a backend game server built using Node.js and TypeScript. It provides a server-authoritative architecture for a multiplayer physics-based sandbox game, supporting various networking protocols and game modes.

## Features

- **Networking**: Implements ENet and WebSocket protocols for efficient data transmission and real-time communication.
- **Game Management**: Supports multiple game modes, player management, and dynamic world loading.
- **Logging**: Structured logging utilities for monitoring server events and errors.

## Project Structure

```
backend-game-server
├── src
│   ├── server.ts          # Entry point for the server
│   ├── config             # Configuration settings
│   │   └── index.ts       # Exports server configuration
│   ├── networking          # Networking protocols
│   │   ├── enet.ts        # ENet protocol implementation
│   │   └── websocket.ts    # WebSocket management
│   ├── game               # Game logic and management
│   │   ├── world.ts       # Game world management
│   │   ├── players.ts     # Player instance management
│   │   └── gamemodes.ts   # Game modes definitions
│   └── utils              # Utility functions
│       └── logger.ts      # Logging utilities
├── package.json           # npm configuration
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd backend-game-server
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Configure environment variables:
   ```
   cp .env.example .env
   ```
   Update secrets and URLs in `.env` before running in shared or production environments.

## Usage

To start the server, run:

```
npm start
```

# Tinybox External Node Server

Optional room-based multiplayer backend that can coexist with the built-in ENet networking. Hosts can create a room from their PC; other players join over the network via WebSocket. The Godot client will choose this backend via a backend selector (planned in Main.gd).

## Features (initial)

- WebSocket transport (default port 30820) with JSON envelopes.
- Rooms with a single host authority; joining peers get numeric peer ids (host is id 1).
- Handshake validates version/name uniqueness per room.
- TBW relay: host can push TBW lines; server fans out to peers.
- Chat/command broadcast, pings, disconnect cleanup.
- In-memory state (no persistence) for early prototyping.

## Protocol (draft)

Messages are JSON `{ type, data }` over WebSocket.

- `create_room` `{ version, name }` -> `room_created { roomId, peerId=1 }`
- `join_room` `{ roomId, version, name }` -> `room_joined { peerId, members }` or `error`
- `chat` `{ text }` -> broadcast `chat { from, text }`
- `load_tbw` `{ lines }` (host only) -> broadcast `tbw { lines }`
- `player_snapshot` `{ payload }` -> fan-out to others as `player_snapshot`
- `kick` / `ban` / `error` reserved.
- `ping` -> `pong`

ENV:

- `PORT` (default 30820)
- `LOG_LEVEL` (info|debug)

## Notes

- This server is stateless across restarts and does not yet persist bans or worlds.
- Security/auth is minimal; production use should add auth + rate limits + TLS.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
