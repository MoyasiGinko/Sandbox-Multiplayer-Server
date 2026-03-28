import { Router, Request, Response } from "express";

const router = Router();

function deprecatedAuthResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node auth register/login are disabled. Use Django auth endpoints at /api/auth/register and /api/auth/login on the Django backend.",
  });
}

// Register endpoint
router.post("/register", (_req: Request, res: Response) => {
  deprecatedAuthResponse(res);
});

// Login endpoint
router.post("/login", (_req: Request, res: Response) => {
  deprecatedAuthResponse(res);
});

// Verify token endpoint
router.get("/verify", async (req: Request, res: Response) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ valid: false, error: "No token provided" });
    return;
  }

  try {
    const { verifyToken } = require("../auth/jwt");
    const user = verifyToken(token);

    if (!user) {
      res.status(403).json({ valid: false, error: "Invalid token" });
      return;
    }

    res.json({
      valid: true,
      user: {
        id: user.userId,
        username: user.username,
        display_name: user.display_name ?? user.username,
      },
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: "Internal server error" });
  }
});

export default router;
