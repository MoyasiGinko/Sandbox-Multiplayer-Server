import { Request, Response, NextFunction } from "express";
import { verifyTokenWithFallback, TokenPayload } from "./jwt";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: "Access token required" });
    return;
  }

  const user = await verifyTokenWithFallback(token);
  if (!user) {
    res.status(403).json({ error: "Invalid or expired token" });
    return;
  }

  req.user = user;
  next();
  })().catch((error: unknown) => {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication check failed" });
  });
}
