import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchChainsFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const updateChainSchema = z
  .object({
    code: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateChainInput = z.infer<typeof updateChainSchema>;

function normalizeNullable(value: UpdateChainInput[keyof UpdateChainInput]) {
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

  const { id: chainId } = await params;
  if (!chainId) {
    return NextResponse.json({ error: "Chain id is required." }, { status: 400 });
  }

  let payload: UpdateChainInput;
  try {
    payload = updateChainSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (payload.code !== undefined) updateData.code = payload.code.trim().toUpperCase();
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (payload.iconUrl !== undefined) updateData.iconUrl = normalizeNullable(payload.iconUrl);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.chains)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.chains.id, chainId))
      .returning({ id: schema.chains.id });

    if (!result.length) {
      return NextResponse.json({ error: "Chain not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update chain.";
    console.error("[chains:update] API error:", message);
    return NextResponse.json({ error: "Failed to update chain." }, { status: 500 });
  }

  const refreshed = await fetchChainsFromDb({
    page: 1,
    pageSize: 1,
    id: chainId
  });

  const updatedChain = refreshed.data.find(row => row.id === chainId) ?? null;

  return NextResponse.json({ data: updatedChain });
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

  const { id: chainId } = await params;
  if (!chainId) {
    return NextResponse.json({ error: "Chain id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.chains.id })
    .from(schema.chains)
    .where(eq(schema.chains.id, chainId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Chain not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.chains).where(eq(schema.chains.id, chainId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete chain.";
    console.error("[chains:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete chain." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: chainId } });
}
