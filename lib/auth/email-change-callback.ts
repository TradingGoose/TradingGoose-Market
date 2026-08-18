export type EmailChangeCallback =
  | { kind: "none" }
  | { kind: "verified" }
  | { kind: "expired" }
  | { kind: "unauthorized" }
  | { kind: "invalid" };

export type EmailChangeCallbackState =
  | EmailChangeCallback
  | { kind: "refreshing" }
  | { kind: "refresh-error" };

const CALLBACK_PARAMETER = "emailChange";
const ERROR_PARAMETER = "error";

function parseError(value: string): Exclude<EmailChangeCallback, { kind: "none" | "verified" }> {
  if (value === "token_expired") return { kind: "expired" };
  if (value === "unauthorized") return { kind: "unauthorized" };
  return { kind: "invalid" };
}

/**
 * Parse only the query parameters owned by Market's verified-email callback.
 * Other parameters belong to the current account page and are deliberately
 * ignored. Better Auth appends `error` to the configured callback URL, so a
 * single error always takes precedence over the success marker.
 */
export function parseEmailChangeCallback(searchParams: URLSearchParams): EmailChangeCallback {
  const errors = searchParams.getAll(ERROR_PARAMETER);
  const callbacks = searchParams.getAll(CALLBACK_PARAMETER);

  if (errors.length > 1) return { kind: "invalid" };
  if (errors.length === 1) return parseError(errors[0] ?? "");
  if (callbacks.length > 1) return { kind: "invalid" };
  if (callbacks.length === 0) return { kind: "none" };
  if (callbacks[0] === "verified") return { kind: "verified" };
  return { kind: "invalid" };
}

/** Remove only Market/Better Auth's callback parameters from a browser URL. */
export function withoutEmailChangeCallback(url: URL): string {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(CALLBACK_PARAMETER);
  cleaned.searchParams.delete(ERROR_PARAMETER);
  return `${cleaned.pathname}${cleaned.search}${cleaned.hash}`;
}
