import jwt from "jsonwebtoken";
import { config } from "../config";

const JWT_SECRET: string = config.jwtSecret;

export interface TokenPayload {
  userId: number;
  username: string;
  display_name?: string;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}
