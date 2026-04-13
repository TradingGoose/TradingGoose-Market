import Redis from "ioredis";
import type { RedisOptions } from "ioredis";

let client: Redis | null = null;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL ?? null;
}

function parseRedisDb(pathname: string): number | undefined {
  const trimmed = pathname.replace(/^\/+/, "").trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildRedisOptions(url: string) {
  const parsed = new URL(url);
  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parseRedisDb(parsed.pathname),
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };

  if (parsed.protocol === "rediss:") {
    return {
      ...options,
      tls: {},
    };
  }

  return options;
}

function unrefRedisStream(redis: Redis) {
  redis.stream?.unref?.();
}

export function getRedis(): Redis | null {
  if (client?.status && client.status !== "end") return client;
  const url = getRedisUrl();
  if (!url) return null;

  try {
    client = new Redis(buildRedisOptions(url));

    client.on("connect", () => {
      if (client) {
        unrefRedisStream(client);
      }
    });
    client.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
    client.on("end", () => {
      client = null;
    });

    void client.connect().catch(() => {
      // Handled by the error listener above
    });
  } catch {
    client = null;
  }

  return client;
}
