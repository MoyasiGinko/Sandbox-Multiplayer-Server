import http from "http";
import https from "https";
import { URL } from "url";
import { config } from "../config";

interface RegistryPayload {
  id: string;
  name: string;
  region: string;
  api_url: string;
  ws_url: string;
  is_public: boolean;
  is_active: boolean;
  current_players: number;
  max_players: number;
  current_rooms: number;
  build_version: string;
}

interface RegistryServerResponse {
  id: string;
  max_rooms?: number;
  current_rooms?: number;
}

interface RegistryEnvelope {
  success?: boolean;
  server?: RegistryServerResponse;
  servers?: RegistryServerResponse[];
}

const REGISTRY_BASE_URL = config.djangoRegistryBaseUrl.replace(/\/+$/, "");

const SERVER_ID = config.gameServerId;
const SERVER_NAME = config.gameServerName;
const SERVER_REGION = config.gameServerRegion;
const SERVER_PUBLIC = config.gameServerPublic;
const SERVER_BUILD = config.gameServerBuild;

const PUBLIC_API_URL = config.publicApiUrl;
const PUBLIC_WS_URL = config.publicWsUrl;

let cachedMaxRooms: number | null = null;
let cachedCurrentRooms = 0;

function requestJson<T>(
  url: string,
  payload?: object,
  method: "GET" | "POST" = "POST",
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = payload ? JSON.stringify(payload) : "";

    const options: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: 5000,
    };

    if (!payload) {
      delete options.headers?.["Content-Length"];
    }

    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(
              `Registry request failed with status ${res.statusCode || 0}`,
            ),
          );
          return;
        }

        const body = Buffer.concat(chunks).toString("utf8").trim();
        if (!body) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(body) as T);
        } catch {
          resolve(null);
        }
      });

    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Registry request timed out"));
    });

    if (payload) {
      req.write(data);
    }
    req.end();
  });
}

function buildPayload(
  currentPlayers: number,
  maxPlayers: number,
  currentRooms: number,
): RegistryPayload {
  return {
    id: SERVER_ID,
    name: SERVER_NAME,
    region: SERVER_REGION,
    api_url: PUBLIC_API_URL,
    ws_url: PUBLIC_WS_URL,
    is_public: SERVER_PUBLIC,
    is_active: true,
    current_players: currentPlayers,
    max_players: maxPlayers,
    current_rooms: currentRooms,
    build_version: SERVER_BUILD,
  };
}

function syncCapacityFromEnvelope(envelope: RegistryEnvelope | null): void {
  const server = envelope?.server;
  if (!server) {
    return;
  }

  if (typeof server.max_rooms === "number" && server.max_rooms >= 0) {
    cachedMaxRooms = Math.floor(server.max_rooms);
  }
  if (typeof server.current_rooms === "number" && server.current_rooms >= 0) {
    cachedCurrentRooms = Math.floor(server.current_rooms);
  }
}

export async function registerGameServer(
  currentPlayers: number,
  maxPlayers: number,
  currentRooms: number,
): Promise<void> {
  const payload = buildPayload(currentPlayers, maxPlayers, currentRooms);
  const response = await requestJson<RegistryEnvelope>(
    `${REGISTRY_BASE_URL}/game-servers`,
    payload,
    "POST",
  );
  syncCapacityFromEnvelope(response);
}

export async function heartbeatGameServer(
  currentPlayers: number,
  maxPlayers: number,
  currentRooms: number,
): Promise<void> {
  const response = await requestJson<RegistryEnvelope>(
    `${REGISTRY_BASE_URL}/game-servers/${encodeURIComponent(SERVER_ID)}/heartbeat`,
    {
      current_players: currentPlayers,
      max_players: maxPlayers,
      current_rooms: currentRooms,
      is_active: true,
    },
    "POST",
  );
  syncCapacityFromEnvelope(response);
}

export async function refreshServerRoomCapacity(): Promise<{
  maxRooms: number | null;
  currentRooms: number;
}> {
  const response = await requestJson<RegistryEnvelope>(
    `${REGISTRY_BASE_URL}/game-servers?public=false`,
    undefined,
    "GET",
  );

  const entry = response?.servers?.find((server) => server.id === SERVER_ID);
  if (entry) {
    if (typeof entry.max_rooms === "number" && entry.max_rooms >= 0) {
      cachedMaxRooms = Math.floor(entry.max_rooms);
    }
    if (typeof entry.current_rooms === "number" && entry.current_rooms >= 0) {
      cachedCurrentRooms = Math.floor(entry.current_rooms);
    }
  }

  return {
    maxRooms: cachedMaxRooms,
    currentRooms: cachedCurrentRooms,
  };
}

export function getCachedServerRoomCapacity(): {
  maxRooms: number | null;
  currentRooms: number;
} {
  return {
    maxRooms: cachedMaxRooms,
    currentRooms: cachedCurrentRooms,
  };
}
