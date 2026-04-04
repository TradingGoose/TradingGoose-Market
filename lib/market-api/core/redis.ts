import Redis from "ioredis";

let client: Redis | null = null;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL ?? null;
}

export function getRedis(): Redis | null {
  if (client) return client;
  const url = getRedisUrl();
  if (!url) return null;

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      lazyConnect: true,
      enableReadyCheck: false,
    });

    client.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });

    void client.connect().catch(() => {
      // Handled by the error listener above
    });
  } catch {
    client = null;
  }

  return client;
}
