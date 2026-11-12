const EMAIL_KEY = "market.verification.email";
const REDIRECT_KEY = "market.verification.redirect";
const SENT_AT_KEY = "market.verification.sent-at";

export function beginEmailVerification(email: string, redirectTo = "/account/api-keys") {
  sessionStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
  sessionStorage.setItem(REDIRECT_KEY, redirectTo);
  sessionStorage.removeItem(SENT_AT_KEY);
}

export function markVerificationCodeSent() {
  sessionStorage.setItem(SENT_AT_KEY, String(Date.now()));
}

export function readEmailVerification() {
  return {
    email: sessionStorage.getItem(EMAIL_KEY) ?? "",
    redirectTo: sessionStorage.getItem(REDIRECT_KEY) ?? "/account/api-keys",
    sentAt: Number(sessionStorage.getItem(SENT_AT_KEY) ?? 0),
  };
}

export function clearEmailVerification() {
  sessionStorage.removeItem(EMAIL_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);
  sessionStorage.removeItem(SENT_AT_KEY);
}
