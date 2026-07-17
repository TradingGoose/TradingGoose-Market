const DEFAULT_SITE_BASE_URL = "http://localhost:3000";

export function getLandingSiteBaseUrl() {
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_SITE_BASE_URL;

  try {
    return new URL(rawUrl).origin;
  } catch {
    return DEFAULT_SITE_BASE_URL;
  }
}

/**
 * NEXT_PUBLIC_APP_URL is inlined at build time; a localhost value in a
 * production build would bake localhost into canonical/OG/JSON-LD URLs,
 * so those tags are skipped until a public origin is configured.
 */
export function isLandingSiteUrlConfigured() {
  const configured = getLandingSiteBaseUrl() !== DEFAULT_SITE_BASE_URL;

  if (!configured && process.env.NODE_ENV === "production") {
    console.warn(
      "NEXT_PUBLIC_APP_URL is not set to a public origin at build time; " +
        "skipping canonical URL, og:url, and JSON-LD structured data on the landing page."
    );
  }

  return configured;
}
