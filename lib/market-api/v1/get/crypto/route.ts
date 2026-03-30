import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { fetchCryptoById, fetchCryptosByIds } from "../../search/cryptos/route";
import { parseListParam } from "../../search/parsing";
import { resolveSearchParams } from "../../search/params";

const MAX_BATCH = 200;

export async function getCrypto(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const cryptoIds = parseListParam(searchParams, "crypto_id");

    if (!cryptoIds.length) {
      return c.json({ error: "crypto_id is required." }, 400);
    }
    if (cryptoIds.length > MAX_BATCH) {
      return c.json({ error: `crypto_id supports up to ${MAX_BATCH} values.` }, 400);
    }

    if (cryptoIds.length === 1) {
      const crypto = await fetchCryptoById(request, cryptoIds[0] ?? "", {
        forceLogoRefresh: true
      });
      if (!crypto) {
        return c.json({ data: null, error: "Crypto not found." }, 404);
      }
      return c.json({ data: crypto });
    }

    const resolved = await fetchCryptosByIds(request, cryptoIds, { forceLogoRefresh: true });
    const data: Record<string, Awaited<ReturnType<typeof fetchCryptoById>> | null> = {};
    for (const id of cryptoIds) {
      data[id] = resolved.get(id) ?? null;
    }
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get/crypto] API error:", message);
    return c.json({ error: message }, 500);
  }
}
