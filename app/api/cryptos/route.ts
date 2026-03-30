import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCryptoOptions, fetchCryptosFromDb, type CryptosQuery } from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";

export const runtime = "nodejs";

type ContractAddressInput = {
  chainId: string;
  address?: string;
  contractType?: string;
};

function normalizeContractAddresses(contracts: ContractAddressInput[]) {
  const seen = new Set<string>();
  const normalized = [];
  for (const contract of contracts) {
    const chainId = contract.chainId.trim();
    const address = (contract.address ?? "").trim();
    const contractType = (contract.contractType ?? "").trim();
    const key = `${chainId}||${address}||${contractType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ chainId, address, contractType });
  }
  return normalized;
}

async function ensureChainsExist(chainIds: string[]) {
  if (!chainIds.length) return true;
  const uniqueIds = Array.from(new Set(chainIds));
  const rows = await db!
    .select({ id: schema.chains.id })
    .from(schema.chains)
    .where(inArray(schema.chains.id, uniqueIds));
  return rows.length === uniqueIds.length;
}

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

export async function GET(request: Request) {
  try {
    if (!db) {
      return NextResponse.json(
        { data: [], error: "Database connection is not configured." },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");
    const isTableRequest = pageParam !== null || pageSizeParam !== null;

    // Option mode for selects
    if (!isTableRequest) {
      const query = searchParams.get("query")?.trim();
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);

      const rows = await fetchCryptoOptions(query ?? null, limit);
      return NextResponse.json({ data: rows });
    }

    // Table (paginated) mode
    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 200);
    const id = searchParams.get("id")?.trim();
    const queryText = searchParams.get("query")?.trim();
    const code = searchParams.get("code")?.trim();
    const name = searchParams.get("name")?.trim();
    const chainId = searchParams.get("chainId")?.trim();
    const assetType = searchParams.get("assetType")?.trim();

    const query: CryptosQuery = {
      page,
      pageSize,
      id,
      query: queryText || undefined,
      code,
      name,
      chainId,
      assetType: assetType || undefined
    };

    const payload = await fetchCryptosFromDb(query);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cryptos] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const contractAddressSchema = z.object({
  chainId: z.string().trim().min(1),
  address: z.string().trim().max(255).optional(),
  contractType: z.string().trim().max(255).optional()
});

const createCryptoSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(255),
  contractAddresses: z.array(contractAddressSchema).min(1),
  active: z.boolean().optional(),
  iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
});

export async function POST(request: Request) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  let payload: z.infer<typeof createCryptoSchema>;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "iconUrl" in body) {
      const iconUrl = (body as { iconUrl?: unknown }).iconUrl;
      if (typeof iconUrl === "string" ? iconUrl.trim().length > 0 : iconUrl != null) {
        return NextResponse.json(
          { error: "iconUrl can only be set via the upload endpoint." },
          { status: 400 }
        );
      }
    }
    payload = createCryptoSchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const code = payload.code.trim().toUpperCase();
  const name = payload.name.trim();
  const contractAddresses = normalizeContractAddresses(payload.contractAddresses);
  if (!contractAddresses.length) {
    return NextResponse.json({ error: "At least one contract address is required." }, { status: 400 });
  }
  const chainIds = contractAddresses.map(contract => contract.chainId);
  if (!(await ensureChainsExist(chainIds))) {
    return NextResponse.json({ error: "Chain not found." }, { status: 400 });
  }
  const iconUrl = null;
  const active = payload.active ?? true;

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.cryptos)
      .values({ code, name, contractAddresses, iconUrl, active })
      .returning({ id: schema.cryptos.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Crypto already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create crypto.";
    console.error("[cryptos:create] API error:", message);
    return NextResponse.json({ error: "Failed to create crypto." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create crypto." }, { status: 500 });
  }

  const refreshed = await fetchCryptosFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdCrypto = refreshed.data.find(row => row.id === newId) ?? null;

  return NextResponse.json({ data: createdCrypto }, { status: 201 });
}
