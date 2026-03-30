import crypto from "crypto";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@tradinggoose/db";
import { renderInvitationEmail } from "@/components/emails/render-email";
import { getSession } from "@/lib/auth/session";
import { sendEmail, hasEmailService } from "@/lib/email/mailer";
import { getFromEmailAddress, getAppUrl } from "@/lib/email/utils";

export const dynamic = "force-dynamic";

// GET: list invitations (admin only)
export async function GET() {
  const session = await getSession();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const invitations = await db
    .select()
    .from(schema.invitation)
    .orderBy(desc(schema.invitation.createdAt));

  return NextResponse.json({ invitations });
}

// POST: create a new invitation (admin only)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await request.json();
  const { email, role } = body as { email?: string; role?: string };

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const validRoles = ["admin", "editor", "viewer"];
  const assignRole = validRoles.includes(role ?? "") ? role! : "viewer";

  // Check if user already exists
  const existingUser = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  // Check for existing pending invitation
  const existingInvite = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(eq(schema.invitation.email, email))
    .limit(1);

  if (existingInvite.length > 0) {
    // Revoke old invitation before creating a new one
    await db
      .update(schema.invitation)
      .set({ status: "revoked" })
      .where(eq(schema.invitation.email, email));
  }

  // Create invitation
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [inv] = await db
    .insert(schema.invitation)
    .values({
      email,
      role: assignRole,
      token,
      invitedBy: session.user.id,
      status: "pending",
      expiresAt,
    })
    .returning();

  // Send invitation email
  const appUrl = getAppUrl();
  const inviteLink = `${appUrl}/invite/${token}`;

  const html = await renderInvitationEmail({
    inviterName: session.user.name,
    invitedEmail: email,
    role: assignRole,
    inviteLink,
    expiresInDays: 7
  });

  const emailResult = await sendEmail({
    to: email,
    subject: `You've been invited to TradingGoose Market`,
    html,
    from: getFromEmailAddress()
  });

  return NextResponse.json({
    invitation: inv,
    emailSent: emailResult.success && emailResult.message !== "skipped",
    hasEmailService: hasEmailService()
  });
}

// DELETE: revoke an invitation (admin only)
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invitation ID required" }, { status: 400 });
  }

  await db
    .update(schema.invitation)
    .set({ status: "revoked" })
    .where(eq(schema.invitation.id, id));

  return NextResponse.json({ success: true });
}
