import { createElement } from "react";
import { render } from "@react-email/render";
import { Resend } from "resend";

import {
  MarketAuthEmail,
  type MarketAuthEmailKind,
} from "@/components/emails/auth-email";
import { getMarketRuntimeConfig } from "@/lib/environment";

type ResendClient = Pick<Resend, "emails" | "contacts">;

export class AuthEmailDeliveryError extends Error {
  readonly kind: "transport" | "response";
  readonly status: number | null;

  constructor(kind: AuthEmailDeliveryError["kind"], status: number | null = null) {
    super("Authentication email delivery failed.");
    this.name = "AuthEmailDeliveryError";
    this.kind = kind;
    this.status = status;
  }
}

function statusFrom(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = "statusCode" in error ? error.statusCode : "status" in error ? error.status : null;
  return typeof value === "number" ? value : null;
}

export function logAuthEmailDeliveryFailure(kind: MarketAuthEmailKind, error: unknown): void {
  console.error("Authentication email delivery failed.", {
    kind,
    errorClass: error instanceof AuthEmailDeliveryError ? error.kind : "unknown",
    status: error instanceof AuthEmailDeliveryError ? error.status : statusFrom(error),
  });
}

const emailCopy = {
  "sign-in-otp": {
    subject: "Your TradingGoose Market verification code",
    text: (otp?: string) => `Your TradingGoose Market verification code is ${otp}. It expires in 15 minutes.`,
  },
  "password-reset": {
    subject: "Reset your TradingGoose Market password",
    text: (_otp?: string, url?: string) => `Reset your TradingGoose Market password: ${url}`,
  },
  "email-change-verification": {
    subject: "Verify your new TradingGoose Market email",
    text: (_otp?: string, url?: string) => `Verify your new TradingGoose Market email: ${url}`,
  },
} as const;

export async function sendMarketAuthEmail(message: {
  kind: MarketAuthEmailKind;
  to: string;
  otp?: string;
  url?: string;
}, client?: ResendClient): Promise<void> {
  const runtime = getMarketRuntimeConfig();
  const resend = client ?? new Resend(runtime.resend.apiKey);
  const content = emailCopy[message.kind];
  const element = createElement(MarketAuthEmail, {
    kind: message.kind,
    otp: message.otp,
    url: message.url,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  let result: Awaited<ReturnType<typeof resend.emails.send>>;
  try {
    result = await resend.emails.send({
      from: runtime.resend.fromEmail,
      to: message.to,
      subject: content.subject,
      html,
      text: text || content.text(message.otp, message.url),
    });
  } catch {
    throw new AuthEmailDeliveryError("transport");
  }

  if (result.error || !result.data?.id) {
    throw new AuthEmailDeliveryError("response", statusFrom(result.error));
  }
}

function isExistingContact(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = statusFrom(error);
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return status === 409 || /already (exists|added)|duplicate/i.test(message);
}

export async function projectVerifiedEmailToAudience(
  email: string,
  client?: ResendClient,
): Promise<void> {
  const runtime = getMarketRuntimeConfig();
  if (!runtime.resend.audienceId) return;
  const resend = client ?? new Resend(runtime.resend.apiKey);

  try {
    const result = await resend.contacts.create({
      audienceId: runtime.resend.audienceId,
      email: email.trim().toLowerCase(),
      unsubscribed: false,
    });
    if (!result.error || isExistingContact(result.error)) return;
    console.warn("Verified-email audience projection failed.", {
      errorClass: "response",
      status: statusFrom(result.error),
    });
  } catch (error) {
    console.warn("Verified-email audience projection failed.", {
      errorClass: "transport",
      status: statusFrom(error),
    });
  }
}
