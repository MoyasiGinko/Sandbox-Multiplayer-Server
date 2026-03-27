import { Router, Request, Response } from "express";
import { StatsRepository } from "../database/repositories/statsRepository";

const router = Router();
const statsRepo = new StatsRepository();

// Get user stats
router.get("/users/:id/stats", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const stats = statsRepo.getStats(userId);

    if (!stats) {
      res.status(404).json({ error: "Stats not found" });
      return;
    }

    // Calculate derived stats
    const kd_ratio =
      stats.deaths > 0
        ? (stats.kills / stats.deaths).toFixed(2)
        : stats.kills.toString();
    const win_rate =
      stats.matches_played > 0
        ? ((stats.wins / stats.matches_played) * 100).toFixed(1)
        : "0.0";
    const playtime_hours = (stats.playtime_seconds / 3600).toFixed(1);

    res.json({
      ...stats,
      kd_ratio: parseFloat(kd_ratio),
      win_rate: parseFloat(win_rate),
      playtime_hours: parseFloat(playtime_hours),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get leaderboard
router.get("/leaderboard", async (req: Request, res: Response) => {
  try {
    const { stat = "kills", limit = "100" } = req.query;
    const leaderboard = statsRepo.getLeaderboard(
      stat as string,
      parseInt(limit as string)
    );

    res.json({
      stat: stat,
      count: leaderboard.length,
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        ...entry,
      })),
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
