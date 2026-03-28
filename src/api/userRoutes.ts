import express, { Request, Response } from "express";

const router = express.Router();

function deprecatedUserResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node user profile/list endpoints are disabled. Use Django user endpoints for profile and user management.",
  });
}

/**
 * GET /api/users
 * Get all active users
 */
router.get("/", (_req: Request, res: Response) => {
  deprecatedUserResponse(res);
});

/**
 * GET /api/users/online
 * Get all online users (active in last N minutes)
 */
router.get("/online", (req: Request, res: Response) => {
  void req;
  deprecatedUserResponse(res);
});

/**
 * PUT /api/users/display-name
 * Update user's display name (requires authentication)
 */
router.put("/display-name", (_req: Request, res: Response) => {
  deprecatedUserResponse(res);
});

export default router;
