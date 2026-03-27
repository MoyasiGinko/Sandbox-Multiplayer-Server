# Backend Game Server - API Testing Guide

## Server Status

✅ Server running on port 30820
✅ Database initialized at: `backend-game-server/database/tinybox.db`
✅ All migrations completed successfully

## API Endpoints

### 1. User Registration

```bash
curl -X POST http://localhost:30820/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testplayer",
    "email": "test@example.com",
    "password": "password123"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "testplayer",
    "email": "test@example.com",
    "created_at": "2026-01-08 12:00:00"
  }
}
```

### 2. User Login

```bash
curl -X POST http://localhost:30820/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testplayer",
    "password": "password123"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "testplayer",
    "email": "test@example.com"
  }
}
```

### 3. Verify Token

```bash
curl -X GET http://localhost:30820/api/auth/verify \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response:**

```json
{
  "valid": true,
  "user": {
    "id": 1,
    "username": "testplayer"
  }
}
```

### 4. Get All Public Rooms (SERVER LIST)

```bash
# Get all active public rooms
curl http://localhost:30820/api/rooms

# Filter by gamemode
curl http://localhost:30820/api/rooms?gamemode=deathmatch
```

**Response:**

```json
{
  "count": 2,
  "rooms": [
    {
      "id": "abc123xyz",
      "host_username": "testplayer",
      "gamemode": "deathmatch",
      "map_name": "Arena",
      "current_players": 3,
      "max_players": 8,
      "created_at": "2026-01-08 12:05:00",
      "is_full": false
    },
    {
      "id": "def456uvw",
      "host_username": "player2",
      "gamemode": "race",
      "map_name": "Track 1",
      "current_players": 2,
      "max_players": 4,
      "created_at": "2026-01-08 12:10:00",
      "is_full": false
    }
  ]
}
```

### 5. Get Specific Room

```bash
curl http://localhost:30820/api/rooms/abc123xyz
```

### 6. Get User Stats

```bash
curl http://localhost:30820/api/users/1/stats
```

**Response:**

```json
{
  "user_id": 1,
  "kills": 25,
  "deaths": 10,
  "wins": 5,
  "losses": 2,
  "playtime_seconds": 7200,
  "matches_played": 7,
  "last_match": "2026-01-08 11:30:00",
  "kd_ratio": 2.5,
  "win_rate": 71.4,
  "playtime_hours": 2.0
}
```

### 7. Get Leaderboard

```bash
# Top 100 by kills (default)
curl http://localhost:30820/api/leaderboard

# Top 50 by wins
curl "http://localhost:30820/api/leaderboard?stat=wins&limit=50"
```

**Response:**

```json
{
  "stat": "kills",
  "count": 100,
  "leaderboard": [
    {
      "rank": 1,
      "username": "ProPlayer",
      "stat_value": 1250,
      "kills": 1250,
      "deaths": 500,
      "wins": 150,
      "losses": 45
    },
    ...
  ]
}
```

## WebSocket Protocol (Updated)

### Connection & Authentication

```javascript
const ws = new WebSocket('ws://localhost:30820');

// Send handshake with JWT token
ws.send(JSON.stringify({
  type: 'handshake',
  data: {
    version: '0.4.0',
    name: 'PlayerName',
    token: 'your_jwt_token_here'  // From login/register
  }
}));

// Response
{
  type: 'handshake_accepted',
  data: {
    peer_id: 0,
    user_id: 1,
    username: 'PlayerName'
  }
}
```

### Create Room (Authenticated Only)

```javascript
ws.send(JSON.stringify({
  type: 'create_room',
  data: {
    gamemode: 'deathmatch',
    map_name: 'Arena',
    max_players: 8,
    is_public: true
  }
}));

// Response
{
  type: 'room_created',
  data: {
    roomId: 'abc123xyz',
    peerId: 1,
    gamemode: 'deathmatch'
  }
}
```

### Join Room (Authenticated Only)

```javascript
ws.send(JSON.stringify({
  type: 'join_room',
  data: {
    roomId: 'abc123xyz',
    version: '0.4.0',
    name: 'PlayerName'
  }
}));

// Response
{
  type: 'room_joined',
  data: {
    roomId: 'abc123xyz',
    peerId: 2,
    members: [
      { peerId: 1, name: 'Host', isHost: true },
      { peerId: 2, name: 'PlayerName', isHost: false }
    ],
    currentTbw: []
  }
}
```

## Features Implemented

✅ **User System:**

- Registration with username/email/password
- Login with JWT token generation
- Token verification middleware
- Password hashing with bcrypt (10 rounds)
- 7-day token expiration

✅ **Database:**

- SQLite with 4 tables (users, player_stats, rooms, match_history)
- Automatic migrations on server start
- Foreign key constraints enabled
- Indexed columns for fast queries

✅ **Room Management:**

- Create authenticated rooms with gamemode metadata
- Public room listing API (GET /api/rooms)
- Filter by gamemode
- Real-time player count updates
- Automatic cleanup of inactive rooms (every 5 minutes)

✅ **Stats System:**

- Automatic stats creation on registration
- User stats endpoint with calculated K/D ratio, win rate
- Leaderboard API with multiple stat types
- Match history tracking (prepared for future)

✅ **WebSocket Authentication:**

- JWT token validation on handshake
- Require authentication for global mode
- Reject unauthenticated room creation/joining
- User ID tracking in sessions

✅ **Security:**

- bcrypt password hashing
- JWT secret from environment
- Input validation with express-validator
- SQL injection prevention (parameterized queries)
- Foreign key constraints

## Database File Location

```
backend-game-server/database/tinybox.db
```

## Environment Variables (Optional)

Create `.env` file:

```env
PORT=30820
JWT_SECRET=your-super-secret-key-change-in-production
NODE_ENV=development
```

## Next Steps for Godot Integration

1. **Create Registration UI** in Godot
2. **Store JWT token** in Godot Global singleton
3. **Send token in WebSocket handshake** via MultiplayerNodeAdapter
4. **Fetch room list** from GET /api/rooms endpoint
5. **Display rooms** in GlobalPlayMenu server list
6. **Implement stats display** in user profile UI

## Testing Commands

### Test user registration:

```bash
curl -X POST http://localhost:30820/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","email":"player1@test.com","password":"12345678"}'
```

### Test login:

```bash
curl -X POST http://localhost:30820/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"12345678"}'
```

### Test room list:

```bash
curl http://localhost:30820/api/rooms
```
