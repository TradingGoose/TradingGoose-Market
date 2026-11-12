import { Unkey } from "@unkey/api";
import type { KeyResponseData, VerifyKeyRatelimitData } from "@unkey/api/models/components";

export const MARKET_PUBLIC_PERMISSION = "market.public" as const;
export const MARKET_PRIVATE_PERMISSION = "market.private" as const;

export type MarketKeyPermission =
  | typeof MARKET_PUBLIC_PERMISSION
  | typeof MARKET_PRIVATE_PERMISSION;

export type UnkeyClientConfig = {
  apiId: string;
  rootKey: string;
  serverUrl?: string;
};

export type CreatedProviderKey = {
  keyId: string;
  key: string;
};

export type ProviderVerification = {
  valid: boolean;
  code: string;
  keyId: string | null;
  permissions: string[];
  ratelimits: VerifyKeyRatelimitData[];
};

export class MarketKeyProviderError extends Error {
  override readonly name = "MarketKeyProviderError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

function providerFailure(operation: string, cause: unknown): never {
  throw new MarketKeyProviderError(`Key provider ${operation} failed`, { cause });
}

export function createUnkeyAdapter(config: UnkeyClientConfig) {
  const client = new Unkey({
    rootKey: config.rootKey,
    retryConfig: { strategy: "none" },
    timeoutMs: 10_000,
    ...(config.serverUrl ? { serverURL: config.serverUrl } : {}),
  });

  return {
    async createKey(input: {
      name: string;
      permission: MarketKeyPermission;
      correlationId: string;
    }): Promise<CreatedProviderKey> {
      try {
        const response = await client.keys.createKey({
          apiId: config.apiId,
          name: input.name,
          prefix: input.permission === MARKET_PUBLIC_PERMISSION ? "tg_pub" : "tg_priv",
          permissions: [input.permission],
          enabled: true,
          recoverable: false,
          meta: { marketCorrelationId: input.correlationId },
        });
        return response.data;
      } catch (error) {
        providerFailure("creation", error);
      }
    },

    async getKey(keyId: string): Promise<KeyResponseData | null> {
      try {
        const response = await client.keys.getKey({ keyId, decrypt: false });
        return response.data;
      } catch (error) {
        if (isProviderNotFound(error)) return null;
        providerFailure("lookup", error);
      }
    },

    async listKeys(): Promise<KeyResponseData[]> {
      try {
        const first = await client.apis.listKeys({
          apiId: config.apiId,
          limit: 100,
          decrypt: false,
          revalidateKeysCache: true,
        });
        const keys: KeyResponseData[] = [];
        for await (const page of first) {
          keys.push(...page.result.data);
        }
        return keys;
      } catch (error) {
        providerFailure("listing", error);
      }
    },

    async deleteKey(keyId: string): Promise<void> {
      try {
        await client.keys.deleteKey({ keyId, permanent: false });
      } catch (error) {
        if (isProviderNotFound(error)) return;
        providerFailure("revocation", error);
      }
    },

    async verifyKey(input: {
      key: string;
      permission: MarketKeyPermission;
      ratelimit?: { name: string; cost: number; limit: number; duration: number };
    }): Promise<ProviderVerification> {
      try {
        const response = await client.keys.verifyKey({
          key: input.key,
          permissions: input.permission,
          ...(input.ratelimit ? { ratelimits: [input.ratelimit] } : {}),
        });
        const data = response.data;
        return {
          valid: data.valid,
          code: String(data.code),
          keyId: data.keyId ?? null,
          permissions: data.permissions ?? [],
          ratelimits: data.ratelimits ?? [],
        };
      } catch (error) {
        providerFailure("verification", error);
      }
    },
  };
}

function isProviderNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { statusCode?: unknown; code?: unknown };
  return value.statusCode === 404 || value.code === "NOT_FOUND";
}

export type UnkeyAdapter = ReturnType<typeof createUnkeyAdapter>;
