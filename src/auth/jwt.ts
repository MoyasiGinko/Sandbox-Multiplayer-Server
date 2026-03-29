import jwt from "jsonwebtoken";
import http from "http";
import https from "https";
import { URL } from "url";
import { config } from "../config";

const JWT_SECRET: string = config.jwtSecret;
const DJANGO_VERIFY_URL = `${config.djangoApiBaseUrl.replace(/\/+$/, "")}/auth/verify`;

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

function verifyTokenViaDjango(token: string): Promise<TokenPayload | null> {
  return new Promise((resolve) => {
    if (!config.djangoApiBaseUrl || config.djangoApiBaseUrl.trim() === "") {
      return resolve(null);
    }

    let target: URL;
    try {
      target = new URL(DJANGO_VERIFY_URL);
    } catch (error) {
      console.warn("Invalid Django verify URL:", error);
      return resolve(null);
    }

    const options: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "sandbox-multiplayer-server/token-verifier",
      },
      timeout: 5000,
    };

    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          return resolve(null);
        }

        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          const parsed = JSON.parse(raw) as {
            valid?: boolean;
            user?: { id?: number; username?: string; display_name?: string };
          };
          if (!parsed.valid || !parsed.user) {
            return resolve(null);
          }

          const userId = Number(parsed.user.id || 0);
          const username = String(parsed.user.username || "").trim();
          if (!userId || username === "") {
            return resolve(null);
          }

          return resolve({
            userId,
            username,
            display_name: String(parsed.user.display_name || username),
          });
        } catch (error) {
          console.warn("Failed to parse Django verify response:", error);
          return resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

export async function verifyTokenWithFallback(
  token: string,
): Promise<TokenPayload | null> {
  const localResult = verifyToken(token);
  if (localResult) {
    return localResult;
  }
  return verifyTokenViaDjango(token);
}
