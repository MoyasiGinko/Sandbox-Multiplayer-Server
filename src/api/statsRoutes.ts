import { Router, Request, Response } from "express";

const router = Router();

function deprecatedUserStatsResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node user stats endpoint is disabled. Use Django user stats endpoints.",
  });
}

// Get user stats
router.get("/users/:id/stats", (_req: Request, res: Response) => {
  deprecatedUserStatsResponse(res);
});

// Get leaderboard
router.get("/leaderboard", (_req: Request, res: Response) => {
  deprecatedUserStatsResponse(res);
});

export default router;
