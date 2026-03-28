import { config as loadEnv } from "dotenv";

loadEnv();

const PORT = Number(process.env.PORT || 30820);
const ENVIRONMENT = process.env.NODE_ENV || "development";
const DJANGO_REGISTRY_BASE_URL =
  process.env.DJANGO_REGISTRY_BASE_URL || "http://127.0.0.1:8000/api";
const DJANGO_API_BASE_URL =
  process.env.DJANGO_API_BASE_URL || DJANGO_REGISTRY_BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-env-for-production";
const GAME_SERVER_ID = process.env.GAME_SERVER_ID || `node-${PORT.toString()}`;
const GAME_SERVER_NAME = process.env.GAME_SERVER_NAME || `Node Server ${PORT}`;
const GAME_SERVER_REGION = process.env.GAME_SERVER_REGION || "global";
const GAME_SERVER_PUBLIC =
  (process.env.GAME_SERVER_PUBLIC || "true").toLowerCase() !== "false";
const GAME_SERVER_BUILD = process.env.GAME_SERVER_BUILD || "";
const PUBLIC_API_URL =
  process.env.PUBLIC_API_URL || `http://127.0.0.1:${PORT.toString()}/api`;
const PUBLIC_WS_URL =
  process.env.PUBLIC_WS_URL || `ws://127.0.0.1:${PORT.toString()}`;

export const config = {
  port: PORT,
  env: ENVIRONMENT,
  djangoRegistryBaseUrl: DJANGO_REGISTRY_BASE_URL,
  djangoApiBaseUrl: DJANGO_API_BASE_URL,
  jwtSecret: JWT_SECRET,
  gameServerId: GAME_SERVER_ID,
  gameServerName: GAME_SERVER_NAME,
  gameServerRegion: GAME_SERVER_REGION,
  gameServerPublic: GAME_SERVER_PUBLIC,
  gameServerBuild: GAME_SERVER_BUILD,
  publicApiUrl: PUBLIC_API_URL,
  publicWsUrl: PUBLIC_WS_URL,
};

export default config;
