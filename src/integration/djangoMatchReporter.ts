import http from "http";
import https from "https";
import { URL } from "url";
import { config } from "../config";

export interface MatchPlayerReport {
  user_id: number;
  kills?: number;
  deaths?: number;
  playtime_seconds?: number;
  won?: boolean;
}

export interface MatchReportPayload {
  room_id: string;
  gamemode?: string;
  winner_user_id?: number | null;
  duration_seconds?: number;
  players: MatchPlayerReport[];
}

const DJANGO_API_BASE_URL = config.djangoApiBaseUrl.replace(/\/+$/, "");

function requestJson<TResponse>(
  url: string,
  payload: object,
  accessToken: string,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = JSON.stringify(payload);

    const options: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 5000,
    };

    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk));
        }
      });

      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(
              `Django match report failed with status ${res.statusCode || 0}: ${responseBody}`,
            ),
          );
          return;
        }

        if (responseBody.length === 0) {
          resolve({} as TResponse);
          return;
        }

        try {
          resolve(JSON.parse(responseBody) as TResponse);
        } catch {
          reject(new Error("Django match report returned invalid JSON"));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Django match report request timed out"));
    });

    req.write(data);
    req.end();
  });
}

export async function reportMatchToDjango(
  accessToken: string,
  payload: MatchReportPayload,
): Promise<{ match_id?: number; processed_players?: number }> {
  const response = await requestJson<{ match_id?: number; processed_players?: number }>(
    `${DJANGO_API_BASE_URL}/matches/report`,
    payload,
    accessToken,
  );
  return response;
}
