import { describe, expect, it } from "vitest";
import {
  decimalUsdToNanoUsd,
  nanoUsdMeetsDecimalThreshold,
  nanoUsdToCentsHalfUp,
  nanoUsdToDecimalUsd,
  usdPerThousandToRequestNanoUsd,
} from "./money";

describe("exact Market billing money", () => {
  it("round trips nano-USD decimals", () => {
    expect(decimalUsdToNanoUsd("12.345678901")).toBe(12_345_678_901n);
    expect(nanoUsdToDecimalUsd(12_345_678_901n)).toBe("12.345678901");
  });

  it("converts the uniform per-thousand price exactly", () => {
    expect(usdPerThousandToRequestNanoUsd("1.5")).toBe(1_500_000n);
  });

  it("uses positive half-up cents conversion", () => {
    expect(nanoUsdToCentsHalfUp(4_999_999n)).toBe(0);
    expect(nanoUsdToCentsHalfUp(5_000_000n)).toBe(1);
    expect(nanoUsdToCentsHalfUp(15_000_000n)).toBe(2);
  });

  it("compares arbitrary-precision deployment thresholds without truncation", () => {
    expect(nanoUsdMeetsDecimalThreshold(1n, "0.000000001")).toBe(true);
    expect(nanoUsdMeetsDecimalThreshold(1n, "0.0000000010")).toBe(true);
    expect(nanoUsdMeetsDecimalThreshold(1n, "0.0000000011")).toBe(false);
  });
});
