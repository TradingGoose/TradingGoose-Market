import { render } from "@react-email/components";

import { InvitationEmail } from "./invitation-email";

interface InvitationEmailData {
  inviterName: string;
  invitedEmail: string;
  role: string;
  inviteLink: string;
  expiresInDays?: number;
}

export async function renderInvitationEmail(data: InvitationEmailData): Promise<string> {
  return await render(InvitationEmail(data));
}
