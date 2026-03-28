# Backend Game Server

## Overview

This project is a backend game server built using Node.js and TypeScript. It provides a server-authoritative architecture for room-based multiplayer over WebSocket.

## Features

- **Networking**: WebSocket protocol for real-time room communication.
- **Room Management**: Host/join flow, room lifecycle, player sessions, and relayed state.
- **Logging**: Structured logging utilities for monitoring server events and errors.

## Project Structure

```text
backend-game-server
├── src
│   ├── server.ts          # Entry point for the server
│   ├── config             # Configuration settings
│   │   └── index.ts       # Exports server configuration
│   ├── networking          # Networking layer
│   │   └── websocket.ts    # WebSocket management
│   ├── game               # Core room logic
│   │   └── roomManager.ts
│   └── utils              # Utility functions
│       └── logger.ts      # Logging utilities
├── package.json           # npm configuration
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   ```

2. Navigate to the project directory:

   ```bash
   cd backend-game-server
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   Update secrets and URLs in `.env` before running in shared or production environments.

## Usage

To start the server, run:

```bash
npm start
```

## Tinybox External Node Server

Optional room-based multiplayer backend. Hosts can create a room; other players join over the network via WebSocket.

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

- Room/session data is runtime-focused and periodically cleaned up.
- Security/auth is minimal; production use should add auth + rate limits + TLS.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
