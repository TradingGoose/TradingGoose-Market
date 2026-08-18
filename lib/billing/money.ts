export const NANO_USD_PER_USD = 1_000_000_000n;

export function decimalUsdToNanoUsd(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) {
    throw new TypeError("USD value must be a non-negative decimal with at most 9 places");
  }
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * NANO_USD_PER_USD + BigInt(fractional.padEnd(9, "0"));
}

export function nanoUsdToDecimalUsd(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / NANO_USD_PER_USD;
  const fraction = (absolute % NANO_USD_PER_USD)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function nanoUsdToCentsHalfUp(value: bigint): number {
  if (value < 0n) throw new RangeError("amount must be non-negative");
  const cents = (value + 5_000_000n) / 10_000_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("amount exceeds safe Stripe integer range");
  }
  return Number(cents);
}

export function nanoUsdMeetsDecimalThreshold(
  valueNanoUsd: bigint,
  thresholdUsd: string,
): boolean {
  if (valueNanoUsd < 0n) throw new RangeError("amount must be non-negative");
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u.exec(thresholdUsd);
  if (!match) throw new TypeError("threshold must be a non-negative decimal");
  const [whole, fractional = ""] = thresholdUsd.split(".");
  const scale = Math.max(9, fractional.length);
  const valueAtScale = valueNanoUsd * 10n ** BigInt(scale - 9);
  const thresholdAtScale =
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fractional.padEnd(scale, "0") || "0");
  return valueAtScale >= thresholdAtScale;
}

export function usdPerThousandToRequestNanoUsd(value: string): bigint {
  const perThousandNanoUsd = decimalUsdToNanoUsd(value);
  if (perThousandNanoUsd <= 0n || perThousandNanoUsd % 1_000n !== 0n) {
    throw new TypeError("rate must produce an exact positive nano-USD per request");
  }
  return perThousandNanoUsd / 1_000n;
}
