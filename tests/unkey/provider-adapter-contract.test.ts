import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordedSdk = {
  options: Record<string, unknown>;
  createKeyInputs: unknown[];
  getKeyInputs: unknown[];
  deleteKeyInputs: unknown[];
  verifyKeyInputs: unknown[];
  getApiInputs: unknown[];
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
      getApi: (input: unknown) => Promise<{ data: { id: string; name: string } }>;
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
        getApiInputs: [],
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
        getApi: async (input) => {
          recorded.getApiInputs.push(input);
          return { data: { id: "api_market", name: "Market" } };
        },
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
  it("constructs distinct no-retry management and verification clients", () => {
    createAdapter();

    expect(sdkState.instances).toHaveLength(2);
    expect(sdkState.instances[0].options).toEqual({
      rootKey: "management-root",
      retryConfig: { strategy: "none" },
      timeoutMs: 10_000,
      serverURL: "https://unkey.test",
    });
    expect(sdkState.instances[1].options).toEqual({
      rootKey: "verification-root",
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

  it("sends manual spend input only through the verification client", async () => {
    const adapter = createAdapter();
    const management = sdkState.instances[0];
    const verification = sdkState.instances[1];

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

    expect(management.verifyKeyInputs).toEqual([]);
    expect(verification.verifyKeyInputs).toEqual([
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
    await adapter.validateApi();

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
    expect(management.getApiInputs).toEqual([{ apiId: "api_market" }]);
  });
});

function createAdapter() {
  return createUnkeyAdapter({
    apiId: "api_market",
    managementRootKey: "management-root",
    verifyRootKey: "verification-root",
    serverUrl: "https://unkey.test",
  });
}
