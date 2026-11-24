export const MARKET_API_VERSION = "v1" as const;

export function requireApiVersion(request: Request): Response | null {
  const versions = new URL(request.url).searchParams.getAll("version");
  if (versions.length === 1 && versions[0] === MARKET_API_VERSION) return null;

  return Response.json(
    { error: "The exact query parameter version=v1 is required." },
    { status: 400, headers: { "x-market-api": "next" } },
  );
}
