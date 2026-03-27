# Backend Architecture - User System & Global Mode

## Overview

Extended Node.js backend for Tinybox with user accounts, player stats, and public room browsing for global mode multiplayer.

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **Web Framework:** Express.js (REST API)
- **WebSocket:** ws library (real-time game communication)
- **Database:** SQLite3 (simple, serverless, file-based)
- **Authentication:** JWT (JSON Web Tokens)
- **Password Security:** bcrypt (password hashing)
- **Validation:** express-validator

## Database Schema

### Users Table

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1
);
```

### Player Stats Table

```sql
CREATE TABLE player_stats (
    user_id INTEGER PRIMARY KEY,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    playtime_seconds INTEGER DEFAULT 0,
    matches_played INTEGER DEFAULT 0,
    last_match DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Rooms Table (for persistence and listing)

```sql
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    host_user_id INTEGER NOT NULL,
    host_username TEXT NOT NULL,
    gamemode TEXT NOT NULL, -- 'deathmatch', 'race', 'koth', etc.
    map_name TEXT,
    max_players INTEGER DEFAULT 8,
    current_players INTEGER DEFAULT 1,
    is_public BOOLEAN DEFAULT 1,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    FOREIGN KEY (host_user_id) REFERENCES users(id)
);
```

### Match History Table (future expansion)

```sql
CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    gamemode TEXT NOT NULL,
    winner_user_id INTEGER,
    started_at DATETIME,
    ended_at DATETIME,
    duration_seconds INTEGER
);
```

## API Endpoints

### Authentication Endpoints

```
POST /api/auth/register
    Body: { username, email, password }
    Returns: { token, user: { id, username, email } }

POST /api/auth/login
    Body: { username, password }
    Returns: { token, user: { id, username, email } }

GET /api/auth/verify
    Headers: Authorization: Bearer <token>
    Returns: { valid: boolean, user: { id, username } }
```

### User & Stats Endpoints

```
GET /api/users/:id/stats
    Returns: { kills, deaths, wins, losses, kd_ratio, win_rate, playtime_hours, matches_played }

GET /api/users/:id/profile
    Returns: { username, created_at, last_login, stats }

PUT /api/users/:id/stats
    Body: { kills_delta, deaths_delta, won, playtime_delta }
    Protected: Requires JWT
```

### Room Management Endpoints

```
GET /api/rooms
    Query: ?gamemode=deathmatch&active_only=true
    Returns: [ { id, host_username, gamemode, map_name, current_players, max_players, created_at } ]

GET /api/rooms/:id
    Returns: { room details + players list }

POST /api/rooms
    Body: { gamemode, map_name?, max_players?, is_public }
    Protected: Requires JWT
    Returns: { room_id, host_peer_id: 1 }

DELETE /api/rooms/:id
    Protected: Requires JWT (host only)
```

### Stats Endpoints

```
GET /api/leaderboard
    Query: ?stat=kills&limit=100
    Returns: [ { username, stat_value, rank } ]
```

## WebSocket Protocol Updates

### Connection Handshake (Updated)

```json
Client → Server:
{
    "type": "handshake",
    "data": {
        "version": "0.4.0",
        "name": "PlayerName",
        "token": "jwt_token_here"
    }
}

Server → Client:
{
    "type": "handshake_accepted",
    "data": {
        "peer_id": 1,
        "user_id": 123,
        "username": "PlayerName"
    }
}
```

### Room Creation (Updated)

```json
Client → Server:
{
    "type": "create_room",
    "data": {
        "gamemode": "deathmatch",
        "map_name": "Arena",
        "max_players": 8,
        "is_public": true
    }
}

Server → Client:
{
    "type": "room_created",
    "data": {
        "room_id": "abc123xyz",
        "peer_id": 1,
        "gamemode": "deathmatch"
    }
}
```

### Match End Stats (New)

```json
Client (Host) → Server:
{
    "type": "match_end",
    "data": {
        "room_id": "abc123",
        "winner_peer_id": 2,
        "stats": [
            { "peer_id": 1, "kills": 5, "deaths": 3 },
            { "peer_id": 2, "kills": 7, "deaths": 2 }
        ],
        "duration_seconds": 300
    }
}
```

## Authentication Flow

### 1. User Registration

```
1. User submits username, email, password
2. Server validates uniqueness
3. Password hashed with bcrypt (10 rounds)
4. User record created
5. player_stats record initialized
6. JWT token generated (expires in 7 days)
7. Token returned to client
```

### 2. User Login

```
1. User submits username/email + password
2. Server finds user by username/email
3. bcrypt compares password with stored hash
4. JWT token generated on success
5. last_login timestamp updated
6. Token returned to client
```

### 3. WebSocket Authentication

```
1. Client connects to WebSocket with JWT in handshake
2. Server verifies JWT signature and expiration
3. User ID extracted from token payload
4. Connection accepted with user context
5. All room operations tied to authenticated user
```

## File Structure

```
backend-game-server/
├── src/
│   ├── server.ts                    # Main entry point
│   ├── database/
│   │   ├── connection.ts            # SQLite connection setup
│   │   ├── migrations.ts            # Schema creation/updates
│   │   └── repositories/
│   │       ├── userRepository.ts    # User CRUD operations
│   │       ├── statsRepository.ts   # Stats read/write
│   │       └── roomRepository.ts    # Room persistence
│   ├── auth/
│   │   ├── jwt.ts                   # Token generation/validation
│   │   ├── password.ts              # bcrypt hashing
│   │   └── middleware.ts            # Express JWT middleware
│   ├── api/
│   │   ├── authRoutes.ts            # /api/auth/*
│   │   ├── userRoutes.ts            # /api/users/*
│   │   ├── roomRoutes.ts            # /api/rooms/*
│   │   └── statsRoutes.ts           # /api/leaderboard
│   ├── game/
│   │   ├── roomManager.ts           # Enhanced with DB persistence
│   │   └── statsTracker.ts          # Match stats aggregation
│   ├── networking/
│   │   └── websocket.ts             # Enhanced with auth
│   ├── config/
│   │   └── constants.ts             # DB path, JWT secret, etc.
│   └── utils/
│       ├── logger.ts                # Winston logger
│       └── validator.ts             # Input validation helpers
├── database/
│   └── tinybox.db                   # SQLite database file
├── .env                             # JWT_SECRET, PORT, etc.
└── package.json
```

## Security Considerations

1. **Password Security:**

   - bcrypt with 10 salt rounds
   - No plain text passwords stored
   - Password minimum length: 8 characters

2. **JWT Security:**

   - Secret stored in .env
   - 7-day expiration
   - Signature verification on every request
   - User ID + username in payload

3. **Input Validation:**

   - Username: 3-20 characters, alphanumeric + underscore
   - Email: valid email format
   - Gamemode: whitelist of valid modes
   - Room ID: alphanumeric only

4. **Rate Limiting:**
   - Login attempts: 5 per minute per IP
   - Room creation: 3 per minute per user
   - API calls: 100 per minute per IP

## Database Choice: SQLite

**Why SQLite?**

- Zero configuration, serverless
- Single file database (easy backup)
- Perfect for small-medium scale (< 10k users)
- Built-in with Node.js via better-sqlite3
- ACID compliant, reliable
- Can migrate to PostgreSQL later if needed

**Migration Path:**
If the game scales beyond 10k concurrent users, migrate to PostgreSQL with minimal code changes (use an ORM or abstraction layer).

## Environment Variables (.env)

```env
# Server
PORT=30820
NODE_ENV=development

# Database
DB_PATH=./database/tinybox.db

# JWT
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRATION=7d

# Game
GAME_VERSION=0.4.0
MAX_ROOMS=1000
```

## Implementation Order

1. ✅ Basic WebSocket server with rooms (already done)
2. 🔄 Database setup with SQLite + migrations
3. 🔄 User registration and login with JWT
4. 🔄 WebSocket authentication integration
5. 🔄 Enhanced room creation with gamemode
6. 🔄 Public room listing API
7. 🔄 Player stats tracking and updates
8. 🔜 Match history (future)
9. 🔜 Ranked matchmaking (future)

## Next Steps

1. Install dependencies: `npm install sqlite3 better-sqlite3 bcrypt jsonwebtoken express-validator`
2. Create database schema and migration system
3. Implement authentication endpoints
4. Update WebSocket to require JWT
5. Add room listing API
6. Test end-to-end flow: register → login → create room → join room
