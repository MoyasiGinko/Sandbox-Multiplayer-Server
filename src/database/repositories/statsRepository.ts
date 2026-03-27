import { getDatabase } from "../connection";

export interface PlayerStats {
  user_id: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  playtime_seconds: number;
  matches_played: number;
  last_match: string | null;
}

export interface UpdateStatsInput {
  userId: number;
  killsDelta?: number;
  deathsDelta?: number;
  won?: boolean;
  playtimeDelta?: number;
}

export class StatsRepository {
  private db = getDatabase();

  getStats(userId: number): PlayerStats | null {
    const stmt = this.db.prepare(
      "SELECT * FROM player_stats WHERE user_id = ?"
    );
    return stmt.get(userId) as PlayerStats | null;
  }

  updateStats(input: UpdateStatsInput): void {
    const {
      userId,
      killsDelta = 0,
      deathsDelta = 0,
      won = false,
      playtimeDelta = 0,
    } = input;

    const stmt = this.db.prepare(`
            UPDATE player_stats
            SET
                kills = kills + ?,
                deaths = deaths + ?,
                wins = wins + ?,
                losses = losses + ?,
                playtime_seconds = playtime_seconds + ?,
                matches_played = matches_played + 1,
                last_match = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `);

    stmt.run(
      killsDelta,
      deathsDelta,
      won ? 1 : 0,
      won ? 0 : 1,
      playtimeDelta,
      userId
    );
  }

  getLeaderboard(stat: string = "kills", limit: number = 100): any[] {
    const validStats = [
      "kills",
      "deaths",
      "wins",
      "losses",
      "playtime_seconds",
      "matches_played",
    ];
    if (!validStats.includes(stat)) {
      stat = "kills";
    }

    const stmt = this.db.prepare(`
            SELECT
                u.username,
                ps.${stat} as stat_value,
                ps.kills,
                ps.deaths,
                ps.wins,
                ps.losses
            FROM player_stats ps
            JOIN users u ON ps.user_id = u.id
            WHERE u.is_active = 1
            ORDER BY ps.${stat} DESC
            LIMIT ?
        `);

    return stmt.all(limit) as any[];
  }
}
