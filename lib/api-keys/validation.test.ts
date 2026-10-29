import { describe, expect, it } from "vitest";
import {
  parseCanonicalLimitUsd,
  parseCustomerKeyCreateInput,
  parseCustomerKeyUpdateInput,
  parseWindowDays,
} from "./validation";

describe("customer API key allowance validation", () => {
  it.each(["1", "2", "999999999999999999999999999999999999999999"])(
    "accepts canonical whole-dollar values without a product maximum: %s",
    (value) => expect(parseCanonicalLimitUsd(value)).toBe(value),
  );

  it.each([0, 1, 1.5, "0", "01", "+1", "-1", " 1", "1 ", "1.0", "1e2"])(
    "rejects a non-canonical limit: %s",
    (value) => expect(() => parseCanonicalLimitUsd(value)).toThrow(),
  );

  it.each([1, 2, 30])("accepts a %d day rolling window", (value) => {
    expect(parseWindowDays(value)).toBe(value);
  });

  it.each([0, 0.5, 31, "1", null])("rejects an invalid day window: %s", (value) => {
    expect(() => parseWindowDays(value)).toThrow();
  });

  it("requires allowance fields as a pair and allows an explicit unlimited pair", () => {
    expect(parseCustomerKeyCreateInput({ name: "Production" })).toEqual({
      name: "Production",
      limitUsd: null,
      windowDays: null,
    });
    expect(
      parseCustomerKeyCreateInput({ name: "Production", limitUsd: null, windowDays: null }),
    ).toEqual({ name: "Production", limitUsd: null, windowDays: null });
    expect(() =>
      parseCustomerKeyCreateInput({ name: "Production", limitUsd: "5" }),
    ).toThrow();
  });

  it("requires optimistic revisions and an explicitly owned allowance pair for edits", () => {
    expect(
      parseCustomerKeyUpdateInput({
        expectedRevision: 2,
        limitUsd: "5",
        windowDays: 7,
      }),
    ).toEqual({ expectedRevision: 2, limitUsd: "5", windowDays: 7 });
    expect(() =>
      parseCustomerKeyUpdateInput({
        expectedRevision: 0,
        limitUsd: null,
        windowDays: null,
      }),
    ).toThrow();

    for (const allowance of [
      {},
      { limitUsd: "5" },
      { windowDays: 7 },
      { limitUsd: null, windowDays: 7 },
      { limitUsd: "5", windowDays: null },
    ]) {
      expect(() =>
        parseCustomerKeyUpdateInput({ expectedRevision: 2, ...allowance }),
      ).toThrow();
    }

    expect(
      parseCustomerKeyUpdateInput({
        expectedRevision: 3,
        limitUsd: null,
        windowDays: null,
      }),
    ).toEqual({ expectedRevision: 3, limitUsd: null, windowDays: null });
  });
});
