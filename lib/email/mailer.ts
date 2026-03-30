import { Resend } from "resend";

import { getFromEmailAddress } from "./utils";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

interface SendEmailResult {
  success: boolean;
  message: string;
}

const resendApiKey = process.env.RESEND_API_KEY;

const resend =
  resendApiKey && resendApiKey !== "re_xxxxx" && resendApiKey.trim() !== ""
    ? new Resend(resendApiKey)
    : null;

export function hasEmailService(): boolean {
  return !!resend;
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  const from = options.from || getFromEmailAddress();

  if (!resend) {
    console.log(
      `[Email] Not sent (no RESEND_API_KEY configured): "${options.subject}" → ${options.to}`
    );
    return { success: true, message: "skipped" };
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html
    });

    if (error) {
      console.error("[Email] Resend error:", error.message);
      return { success: false, message: error.message };
    }

    return { success: true, message: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Email] Failed to send:", message);
    return { success: false, message };
  }
}
