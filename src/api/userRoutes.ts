import express, { Request, Response } from "express";
import { UserRepository } from "../database/repositories/userRepository";
import { body, validationResult } from "express-validator";
import { authenticateToken } from "../auth/middleware";

const router = express.Router();
const userRepo = new UserRepository();

/**
 * GET /api/users
 * Get all active users
 */
router.get("/", (_req: Request, res: Response) => {
  try {
    const users = userRepo.getAllUsers();

    // Return user info without password hashes
    const safeUsers = users.map((user) => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name ?? user.username,
      created_at: user.created_at,
      last_login: user.last_login,
      is_active: user.is_active,
    }));

    res.json({
      success: true,
      total: safeUsers.length,
      users: safeUsers,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      error: "Failed to fetch users",
    });
  }
});

/**
 * GET /api/users/online
 * Get all online users (active in last N minutes)
 */
router.get("/online", (req: Request, res: Response) => {
  try {
    // Allow customizing the active window via query param (default 5 minutes)
    const minutesSinceActive = parseInt(req.query.minutes as string) || 5;

    const onlineUsers = userRepo.getOnlineUsers(minutesSinceActive);

    // Return user info without password hashes
    const safeUsers = onlineUsers.map((user) => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name ?? user.username,
      created_at: user.created_at,
      last_login: user.last_login,
      is_active: user.is_active,
    }));

    res.json({
      success: true,
      total: safeUsers.length,
      minutesSinceActive: minutesSinceActive,
      users: safeUsers,
    });
  } catch (error) {
    console.error("Error fetching online users:", error);
    res.status(500).json({
      error: "Failed to fetch online users",
    });
  }
});

/**
 * PUT /api/users/display-name
 * Update user's display name (requires authentication)
 */
router.put(
  "/display-name",
  authenticateToken,
  body("display_name")
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage("Display name must be between 1 and 30 characters"),
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { display_name } = req.body;
      const userId = (req as any).user.userId;

      const updatedUser = userRepo.updateDisplayName(userId, display_name);

      if (!updatedUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({
        success: true,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          display_name: updatedUser.display_name,
        },
      });
    } catch (error) {
      console.error("Error updating display name:", error);
      res.status(500).json({
        error: "Failed to update display name",
      });
    }
  }
);

export default router;
