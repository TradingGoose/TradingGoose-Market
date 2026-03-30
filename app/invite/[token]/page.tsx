import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db, schema } from "@tradinggoose/db";
import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  if (!db) {
    throw new Error("Database not configured");
  }

  const [inv] = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      token: schema.invitation.token,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt
    })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.token, token),
        eq(schema.invitation.status, "pending")
      )
    )
    .limit(1);

  if (!inv) {
    notFound();
  }

  const expired = new Date() > inv.expiresAt;

  return (
    <AcceptInviteForm
      token={inv.token}
      email={inv.email}
      role={inv.role}
      expired={expired}
    />
  );
}
