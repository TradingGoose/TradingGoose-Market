import { buildServePayload, resolveServeKeyFromPath } from "@uploads/core/serve";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const key = resolveServeKeyFromPath(new URL(request.url).pathname);
  if (!key) {
    return new Response(JSON.stringify({ error: "File key is required." }), {
      status: 400,
      headers: { "content-type": "application/json", "x-market-api": "next" }
    });
  }

  try {
    const { body, contentType, contentLength } = await buildServePayload(key);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(contentLength),
        "cache-control": "public, max-age=31536000, immutable",
        "x-market-api": "next"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File not found.";
    return new Response(JSON.stringify({ error: message }), {
      status: 404,
      headers: { "content-type": "application/json", "x-market-api": "next" }
    });
  }
}
