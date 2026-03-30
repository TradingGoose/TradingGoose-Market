import { NextResponse } from "next/server";

export type ApiContext = {
  req: {
    raw: Request;
    path: string;
    json: () => Promise<unknown>;
  };
  header: (name: string, value: string) => void;
  json: (data: unknown, init?: number | ResponseInit) => Response;
  body: (body: BodyInit, status?: number) => Response;
};

export function createApiContext(request: Request): ApiContext {
  const headers = new Headers({ "x-market-api": "next" });
  const path = new URL(request.url).pathname;

  return {
    req: {
      raw: request,
      path,
      json: () => request.json()
    },
    header: (name, value) => {
      headers.set(name, value);
    },
    json: (data, init) => {
      let status = 200;
      let responseInit: ResponseInit = {};
      if (typeof init === "number") {
        status = init;
      } else if (init) {
        status = init.status ?? 200;
        responseInit = init;
      }

      const mergedHeaders = new Headers(responseInit.headers);
      headers.forEach((value, key) => {
        mergedHeaders.set(key, value);
      });

      return NextResponse.json(data, { ...responseInit, status, headers: mergedHeaders });
    },
    body: (body, status = 200) => {
      const mergedHeaders = new Headers();
      headers.forEach((value, key) => {
        mergedHeaders.set(key, value);
      });
      return new Response(body, { status, headers: mergedHeaders });
    }
  };
}

export function withApiContextRequest(context: ApiContext, request: Request): ApiContext {
  return {
    ...context,
    req: {
      raw: request,
      path: new URL(request.url).pathname,
      json: () => request.json()
    }
  };
}
