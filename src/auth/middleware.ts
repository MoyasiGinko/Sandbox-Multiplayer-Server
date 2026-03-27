import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload } from "./jwt";
import { UserRepository } from "../database/repositories/userRepository";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

const userRepo = new UserRepository();

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: "Access token required" });
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    res.status(403).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    const synced = userRepo.ensureExternalUser(
      user.userId,
      user.username,
      user.display_name,
    );
    if (!synced) {
      res.status(500).json({ error: "Unable to sync authenticated user" });
      return;
    }
  } catch (error) {
    console.error("Failed to sync authenticated user:", error);
    res.status(500).json({ error: "Unable to sync authenticated user" });
    return;
  }

  req.user = user;
  next();
}
