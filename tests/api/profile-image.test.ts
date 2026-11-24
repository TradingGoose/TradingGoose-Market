import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  image: null as string | null,
  failUpdate: false,
  transactionTail: Promise.resolve() as Promise<void>,
  guard: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ apiRequireCustomerSession: state.guard }));
vi.mock("@uploads/core/storage-client", () => ({
  uploadFileWithKey: state.upload,
  deleteFile: state.remove,
  extractStorageKey: (path: string | null) => path
    ? { provider: "local", key: path.replace(/^\/api\/files\/serve\//, "") }
    : null,
}));
vi.mock("@tradinggoose/db", () => ({
  schema: {
    user: { id: "id", image: "image", updatedAt: "updatedAt" },
  },
}));
vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => {
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => [{ image: state.image }] }),
          }),
        }),
      }),
      update: () => ({
        set: (values: { image: string | null }) => ({
          where: () => ({
            returning: async () => {
              if (state.failUpdate) throw new Error("db unavailable");
              state.image = values.image;
              return [{ id: "user_1" }];
            },
          }),
        }),
      }),
    };
    return {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => {
        const previous = state.transactionTail;
        let release!: () => void;
        state.transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(transaction);
        } finally {
          release();
        }
      },
    };
  },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => true) }));

import { DELETE, GET, POST } from "../../app/api/account/profile/image/route";

function pngFile(type = "image/png") {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  ], "avatar.png", { type });
}

beforeEach(() => {
  state.image = null;
  state.failUpdate = false;
  state.transactionTail = Promise.resolve();
  state.guard.mockReset().mockResolvedValue({
    user: { id: "user_1", emailVerified: true },
  });
  state.upload.mockReset().mockResolvedValue({
    path: "/api/files/serve/profile-pictures/user_1/new.png",
    key: "profile-pictures/user_1/new.png",
    name: "new.png",
    size: 12,
    type: "image/png",
  });
  state.remove.mockReset().mockResolvedValue(undefined);
});

describe("profile image route", () => {
  it("rejects unsupported methods before session or storage work", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    expect(state.guard).not.toHaveBeenCalled();
  });

  it("accepts exactly one matching decoded PNG and persists its served URL", async () => {
    const form = new FormData();
    form.set("file", pngFile());
    const response = await POST(new Request("https://market.example.com/api/account/profile/image", {
      method: "POST",
      headers: { origin: "https://market.example.com" },
      body: form,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ image: "/api/files/serve/profile-pictures/user_1/new.png" });
    expect(state.upload).toHaveBeenCalledOnce();
    const [bytes, key, mime, size] = state.upload.mock.calls[0];
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes).toEqual(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]));
    expect(key).toMatch(/^profile-pictures\/user_1\/[0-9a-f-]+\.png$/u);
    expect(mime).toBe("image/png");
    expect(size).toBe(12);
    expect(state.image).toBe("/api/files/serve/profile-pictures/user_1/new.png");
  });

  it("rejects MIME/signature disagreement without uploading", async () => {
    const form = new FormData();
    form.set("file", pngFile("image/jpeg"));
    const response = await POST(new Request("https://market.example.com/api/account/profile/image", {
      method: "POST",
      headers: { origin: "https://market.example.com" },
      body: form,
    }));
    expect(response.status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before consuming the request stream", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await POST(new Request("https://market.example.com/api/account/profile/image", {
      method: "POST",
      headers: {
        origin: "https://market.example.com",
        "content-length": String(6 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=profile",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(400);
    // The Request constructor may perform one stream backpressure pull; the
    // route cancels without consuming the declared oversized body.
    expect(pulls).toBeLessThanOrEqual(1);
    expect(cancelled).toBe(true);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("cancels a chunked multipart stream once its raw byte ceiling is crossed", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(
          pulls === 1 ? (5 * 1024 * 1024) + (64 * 1024) : 1,
        ));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await POST(new Request("https://market.example.com/api/account/profile/image", {
      method: "POST",
      headers: {
        origin: "https://market.example.com",
        "content-type": "multipart/form-data; boundary=profile",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(400);
    expect(pulls).toBeGreaterThanOrEqual(2);
    expect(pulls).toBeLessThanOrEqual(3);
    expect(cancelled).toBe(true);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("cleans a newly uploaded object when the database update fails", async () => {
    state.failUpdate = true;
    const form = new FormData();
    form.set("file", pngFile());
    const response = await POST(new Request("https://market.example.com/api/account/profile/image", {
      method: "POST",
      headers: { origin: "https://market.example.com" },
      body: form,
    }));
    expect(response.status).toBe(503);
    expect(state.remove).toHaveBeenCalledWith("profile-pictures/user_1/new.png", "local");
  });

  it("serializes concurrent replacements and cleans the exact displaced objects", async () => {
    state.image = "/api/files/serve/profile-pictures/user_1/old.png";
    const uploadedPaths = [
      "/api/files/serve/profile-pictures/user_1/first.png",
      "/api/files/serve/profile-pictures/user_1/second.png",
    ];
    state.upload
      .mockResolvedValueOnce({ path: uploadedPaths[0] })
      .mockResolvedValueOnce({ path: uploadedPaths[1] });

    const request = () => {
      const form = new FormData();
      form.set("file", pngFile());
      return new Request("https://market.example.com/api/account/profile/image", {
        method: "POST",
        headers: { origin: "https://market.example.com" },
        body: form,
      });
    };
    const responses = await Promise.all([POST(request()), POST(request())]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(uploadedPaths).toContain(state.image);
    const displacedUpload = uploadedPaths.find((path) => path !== state.image);
    expect(displacedUpload).toBeDefined();
    expect(state.remove).toHaveBeenCalledWith(
      "profile-pictures/user_1/old.png",
      "local",
    );
    expect(state.remove).toHaveBeenCalledWith(
      displacedUpload!.replace("/api/files/serve/", ""),
      "local",
    );
    expect(state.remove).not.toHaveBeenCalledWith(
      state.image!.replace("/api/files/serve/", ""),
      "local",
    );
  });

  it("removes the database URL before best-effort cleanup and rejects DELETE bodies", async () => {
    state.image = "/api/files/serve/profile-pictures/user_1/old.png";
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const rejected = await DELETE(new Request("https://market.example.com/api/account/profile/image", {
      method: "DELETE",
      headers: { origin: "https://market.example.com" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(rejected.status).toBe(400);
    expect(pulls).toBeLessThanOrEqual(1);
    expect(cancelled).toBe(true);
    expect(state.image).not.toBeNull();

    const accepted = await DELETE(new Request("https://market.example.com/api/account/profile/image", {
      method: "DELETE",
      headers: { origin: "https://market.example.com" },
    }));
    expect(accepted.status).toBe(200);
    expect(state.image).toBeNull();
    expect(state.remove).toHaveBeenCalledWith("profile-pictures/user_1/old.png", "local");
  });
});
