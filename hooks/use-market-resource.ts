"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class MarketApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "MarketApiError";
    this.status = status;
    this.code = code;
  }
}

export async function marketApiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new MarketApiError(response.status, payload.error ?? "REQUEST_FAILED");
  }
  return payload as T;
}

export function useMarketResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await marketApiRequest<T>(url);
      if (generation === requestGeneration.current) setData(result);
    } catch (requestError) {
      if (generation === requestGeneration.current) {
        setError(requestError instanceof MarketApiError ? requestError.code : "REQUEST_FAILED");
      }
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void refresh();
    });
    return () => {
      disposed = true;
      requestGeneration.current += 1;
    };
  }, [refresh]);

  return { data, error, isLoading, refresh, setData };
}
