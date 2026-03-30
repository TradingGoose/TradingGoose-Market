import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCryptosFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const contractAddressSchema = z.object({
  chainId: z.string().trim().min(1),
  address: z.string().trim().max(255).optional(),
  contractType: z.string().trim().max(255).optional()
});

const updateCryptoSchema = z
  .object({
    code: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    contractAddresses: z.array(contractAddressSchema).min(1).optional(),
    active: z.boolean().optional(),
    iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateCryptoInput = z.infer<typeof updateCryptoSchema>;

function normalizeContractAddresses(contracts: { chainId: string; address?: string; contractType?: string }[]) {
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

function normalizeNullable(value: UpdateCryptoInput[keyof UpdateCryptoInput]) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value as string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: cryptoId } = await params;
  if (!cryptoId) {
    return NextResponse.json({ error: "Crypto id is required." }, { status: 400 });
  }

  let payload: UpdateCryptoInput;
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
    payload = updateCryptoSchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (payload.code !== undefined) updateData.code = payload.code.trim().toUpperCase();
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (payload.contractAddresses !== undefined) {
    const normalized = normalizeContractAddresses(payload.contractAddresses);
    if (!normalized.length) {
      return NextResponse.json({ error: "At least one contract address is required." }, { status: 400 });
    }
    const chainIds = normalized.map(contract => contract.chainId);
    if (!(await ensureChainsExist(chainIds))) {
      return NextResponse.json({ error: "Chain not found." }, { status: 400 });
    }
    updateData.contractAddresses = normalized;
  }
  if (payload.active !== undefined) updateData.active = payload.active;
  if (payload.iconUrl !== undefined) updateData.iconUrl = normalizeNullable(payload.iconUrl);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.cryptos)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.cryptos.id, cryptoId))
      .returning({ id: schema.cryptos.id });

    if (!result.length) {
      return NextResponse.json({ error: "Crypto not found." }, { status: 404 });
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to update crypto.";
    console.error("[cryptos:update] API error:", message);
    return NextResponse.json({ error: "Failed to update crypto." }, { status: 500 });
  }

  const refreshed = await fetchCryptosFromDb({
    page: 1,
    pageSize: 1,
    id: cryptoId
  });

  const updatedCrypto = refreshed.data.find(row => row.id === cryptoId) ?? null;

  return NextResponse.json({ data: updatedCrypto });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: cryptoId } = await params;
  if (!cryptoId) {
    return NextResponse.json({ error: "Crypto id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.cryptos.id })
    .from(schema.cryptos)
    .where(eq(schema.cryptos.id, cryptoId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Crypto not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.cryptos).where(eq(schema.cryptos.id, cryptoId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete crypto.";
    console.error("[cryptos:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete crypto." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: cryptoId } });
}
