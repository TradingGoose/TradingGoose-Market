import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@tradinggoose/db";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await request.json();
  const { token, name, password } = body as {
    token?: string;
    name?: string;
    password?: string;
  };

  if (!token || !name?.trim() || !password) {
    return NextResponse.json(
      { error: "Token, name, and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Find the invitation
  const [inv] = await db
    .select()
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.token, token),
        eq(schema.invitation.status, "pending")
      )
    )
    .limit(1);

  if (!inv) {
    return NextResponse.json(
      { error: "Invalid or expired invitation" },
      { status: 404 }
    );
  }

  // Check expiry
  if (new Date() > inv.expiresAt) {
    await db
      .update(schema.invitation)
      .set({ status: "expired" })
      .where(eq(schema.invitation.id, inv.id));

    return NextResponse.json(
      { error: "This invitation has expired. Please ask your admin for a new one." },
      { status: 410 }
    );
  }

  // Check if user already exists
  const existingUser = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, inv.email))
    .limit(1);

  if (existingUser.length > 0) {
    await db
      .update(schema.invitation)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(schema.invitation.id, inv.id));

    return NextResponse.json(
      { error: "An account with this email already exists. Please log in instead." },
      { status: 409 }
    );
  }

  // Create user via better-auth admin API (server-side, bypasses signup hook)
  try {
    await auth.api.signUpEmail({
      body: {
        name: name.trim(),
        email: inv.email,
        password
      }
    });

    // Set the user's role (signUp creates with default role, we need to update it)
    const [newUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, inv.email))
      .limit(1);

    if (newUser) {
      await db
        .update(schema.user)
        .set({ role: inv.role })
        .where(eq(schema.user.id, newUser.id));
    }

    // Mark invitation as accepted
    await db
      .update(schema.invitation)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(schema.invitation.id, inv.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
