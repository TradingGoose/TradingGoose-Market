type SearchBody = Record<string, unknown>;

function isPlainObject(value: unknown): value is SearchBody {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyBodyParam(params: URLSearchParams, key: string, value: unknown) {
  params.delete(key);
  params.delete(`${key}[]`);

  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === null || item === undefined) continue;
      params.append(key, String(item));
    }
    return;
  }

  if (typeof value === "object") {
    params.set(key, JSON.stringify(value));
    return;
  }

  params.set(key, String(value));
}

export async function resolveSearchParams(request: Request): Promise<URLSearchParams> {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return params;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return params;
  }

  if (!isPlainObject(body)) return params;

  for (const [key, value] of Object.entries(body)) {
    applyBodyParam(params, key, value);
  }

  return params;
}
