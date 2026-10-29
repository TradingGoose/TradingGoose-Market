const CANONICAL_LIMIT_USD = /^[1-9]\d*$/;

export type CustomerKeyAllowance =
  | { limitUsd: null; windowDays: null }
  | { limitUsd: string; windowDays: number };

export type CustomerKeyCreateInput = CustomerKeyAllowance & { name: string };
export type CustomerKeyUpdateInput = CustomerKeyAllowance & { expectedRevision: number };

export class ApiKeyInputError extends Error {
  override readonly name = "ApiKeyInputError";
}

export async function readApiKeyJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiKeyInputError("request body must be valid JSON");
  }
}

export function parseCustomerKeyCreateInput(input: unknown): CustomerKeyCreateInput {
  const record = objectInput(input);
  rejectUnknownKeys(record, ["name", "limitUsd", "windowDays"]);
  const name = parseName(record.name);
  return { name, ...parseCreateAllowance(record) };
}

export function parseCustomerKeyUpdateInput(input: unknown): CustomerKeyUpdateInput {
  const record = objectInput(input);
  rejectUnknownKeys(record, ["expectedRevision", "limitUsd", "windowDays"]);
  if (!Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 1) {
    throw new ApiKeyInputError("expectedRevision must be a positive integer");
  }
  return {
    expectedRevision: Number(record.expectedRevision),
    ...parseUpdateAllowance(record),
  };
}

export function parseAdminKeyCreateInput(input: unknown) {
  const record = objectInput(input);
  rejectUnknownKeys(record, ["name"]);
  return { name: parseName(record.name) };
}

export function parseCanonicalLimitUsd(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_LIMIT_USD.test(value)) {
    throw new ApiKeyInputError(
      "limitUsd must be a canonical positive whole-dollar string",
    );
  }
  BigInt(value);
  return value;
}

export function parseWindowDays(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 30) {
    throw new ApiKeyInputError("windowDays must be an integer from 1 through 30");
  }
  return Number(value);
}

function parseCreateAllowance(record: Record<string, unknown>): CustomerKeyAllowance {
  const hasLimit = Object.hasOwn(record, "limitUsd");
  const hasWindow = Object.hasOwn(record, "windowDays");
  if (!hasLimit && !hasWindow) return { limitUsd: null, windowDays: null };
  return parseOwnedAllowancePair(record, hasLimit, hasWindow);
}

function parseUpdateAllowance(record: Record<string, unknown>): CustomerKeyAllowance {
  const hasLimit = Object.hasOwn(record, "limitUsd");
  const hasWindow = Object.hasOwn(record, "windowDays");
  if (!hasLimit || !hasWindow) {
    throw new ApiKeyInputError(
      "limitUsd and windowDays must both be supplied when editing an API key",
    );
  }
  return parseOwnedAllowancePair(record, hasLimit, hasWindow);
}

function parseOwnedAllowancePair(
  record: Record<string, unknown>,
  hasLimit: boolean,
  hasWindow: boolean,
): CustomerKeyAllowance {
  if (record.limitUsd === null && record.windowDays === null) {
    return { limitUsd: null, windowDays: null };
  }
  if (!hasLimit || !hasWindow || record.limitUsd === null || record.windowDays === null) {
    throw new ApiKeyInputError("limitUsd and windowDays must be supplied together");
  }
  return {
    limitUsd: parseCanonicalLimitUsd(record.limitUsd),
    windowDays: parseWindowDays(record.windowDays),
  };
}

function parseName(value: unknown): string {
  if (typeof value !== "string") throw new ApiKeyInputError("name is required");
  const name = value.trim();
  if (name.length < 1 || name.length > 80 || hasControl(name)) {
    throw new ApiKeyInputError("name must contain 1 to 80 printable characters");
  }
  return name;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiKeyInputError("request body must be an object");
  }
  return input as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) {
    throw new ApiKeyInputError("request body contains unsupported fields");
  }
}

function hasControl(value: string) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}
