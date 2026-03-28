import { Router, Request, Response } from "express";

const router = Router();

function deprecatedAuthResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node auth endpoints are disabled. Use Django auth endpoints at /api/auth/register, /api/auth/login, and /api/auth/verify on the Django backend.",
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
router.get("/verify", (_req: Request, res: Response) => {
  deprecatedAuthResponse(res);
});

export default router;
