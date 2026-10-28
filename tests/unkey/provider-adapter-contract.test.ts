import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordedSdk = {
  options: Record<string, unknown>;
  createKeyInputs: unknown[];
  getKeyInputs: unknown[];
  deleteKeyInputs: unknown[];
  verifyKeyInputs: unknown[];
  listKeysInputs: unknown[];
  listPages: Array<Array<Record<string, unknown>>>;
};

const sdkState = vi.hoisted(() => ({
  instances: [] as RecordedSdk[],
}));

vi.mock("@unkey/api", () => ({
  Unkey: class {
    readonly keys: {
      createKey: (input: unknown) => Promise<{ data: { keyId: string; key: string } }>;
      getKey: (input: unknown) => Promise<{ data: Record<string, unknown> }>;
      deleteKey: (input: unknown) => Promise<{ data: Record<string, never> }>;
      verifyKey: (input: unknown) => Promise<{
        data: {
          valid: boolean;
          code: string;
          keyId: string;
          permissions: string[];
          ratelimits: Array<Record<string, unknown>>;
        };
      }>;
    };
    readonly apis: {
      listKeys: (input: unknown) => Promise<AsyncIterable<{
        result: { data: Array<Record<string, unknown>> };
      }>>;
    };

    constructor(options: Record<string, unknown>) {
      const recorded: RecordedSdk = {
        options,
        createKeyInputs: [],
        getKeyInputs: [],
        deleteKeyInputs: [],
        verifyKeyInputs: [],
        listKeysInputs: [],
        listPages: [[]],
      };
      sdkState.instances.push(recorded);

      this.keys = {
        createKey: async (input) => {
          recorded.createKeyInputs.push(input);
          return { data: { keyId: "key_provider", key: "tg_secret_once" } };
        },
        getKey: async (input) => {
          recorded.getKeyInputs.push(input);
          return { data: { keyId: "key_provider", enabled: true } };
        },
        deleteKey: async (input) => {
          recorded.deleteKeyInputs.push(input);
          return { data: {} };
        },
        verifyKey: async (input) => {
          recorded.verifyKeyInputs.push(input);
          return {
            data: {
              valid: true,
              code: "VALID",
              keyId: "key_provider",
              permissions: ["market.public"],
              ratelimits: [],
            },
          };
        },
      };
      this.apis = {
        listKeys: async (input) => {
          recorded.listKeysInputs.push(input);
          const pages = recorded.listPages;
          return {
            async *[Symbol.asyncIterator]() {
              for (const data of pages) yield { result: { data } };
            },
          };
        },
      };
    }
  },
}));

import { createUnkeyAdapter } from "../../lib/unkey/client";

beforeEach(() => {
  sdkState.instances.length = 0;
});

describe("Market Unkey adapter contract", () => {
  it("constructs one no-retry client for management and verification", () => {
    createAdapter();

    expect(sdkState.instances).toHaveLength(1);
    expect(sdkState.instances[0].options).toEqual({
      rootKey: "unkey-root",
      retryConfig: { strategy: "none" },
      timeoutMs: 10_000,
      serverURL: "https://unkey.test",
    });
  });

  it("creates public and private keys with only the canonical class permission", async () => {
    const adapter = createAdapter();
    const management = sdkState.instances[0];

    await adapter.createKey({
      name: "Customer key",
      permission: "market.public",
      correlationId: "attempt_public",
    });
    await adapter.createKey({
      name: "Admin key",
      permission: "market.private",
      correlationId: "attempt_private",
    });

    expect(management.createKeyInputs).toEqual([
      {
        apiId: "api_market",
        name: "Customer key",
        prefix: "tg_pub",
        permissions: ["market.public"],
        enabled: true,
        recoverable: false,
        meta: { marketCorrelationId: "attempt_public" },
      },
      {
        apiId: "api_market",
        name: "Admin key",
        prefix: "tg_priv",
        permissions: ["market.private"],
        enabled: true,
        recoverable: false,
        meta: { marketCorrelationId: "attempt_private" },
      },
    ]);
  });

  it("sends manual spend input through the same root client", async () => {
    const adapter = createAdapter();
    const client = sdkState.instances[0];

    await adapter.verifyKey({
      key: "tg_secret",
      permission: "market.public",
      ratelimit: {
        name: "market-spend-q_digest",
        cost: 0,
        limit: 5_000,
        duration: 604_800_000,
      },
    });

    expect(sdkState.instances).toHaveLength(1);
    expect(client.verifyKeyInputs).toEqual([
      {
        key: "tg_secret",
        permissions: "market.public",
        ratelimits: [
          {
            name: "market-spend-q_digest",
            cost: 0,
            limit: 5_000,
            duration: 604_800_000,
          },
        ],
      },
    ]);
  });

  it("uses non-decrypting exhaustive API listing and soft deletion", async () => {
    const adapter = createAdapter();
    const management = sdkState.instances[0];
    management.listPages = [
      [{ keyId: "key_1", enabled: true }],
      [{ keyId: "key_2", enabled: false }],
    ];

    await expect(adapter.listKeys()).resolves.toEqual([
      { keyId: "key_1", enabled: true },
      { keyId: "key_2", enabled: false },
    ]);
    await adapter.getKey("key_1");
    await adapter.deleteKey("key_1");

    expect(management.listKeysInputs).toEqual([
      {
        apiId: "api_market",
        limit: 100,
        decrypt: false,
        revalidateKeysCache: true,
      },
    ]);
    expect(management.getKeyInputs).toEqual([{ keyId: "key_1", decrypt: false }]);
    expect(management.deleteKeyInputs).toEqual([
      { keyId: "key_1", permanent: false },
    ]);
  });
});

function createAdapter() {
  return createUnkeyAdapter({
    apiId: "api_market",
    rootKey: "unkey-root",
    serverUrl: "https://unkey.test",
  });
}
