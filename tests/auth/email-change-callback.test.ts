import { describe, expect, it } from "vitest";

import {
  parseEmailChangeCallback,
  withoutEmailChangeCallback,
} from "../../lib/auth/email-change-callback";

describe("Market email-change callback", () => {
  it("ignores query state owned by the account page", () => {
    expect(parseEmailChangeCallback(new URLSearchParams("range=30d&key=key_1"))).toEqual({
      kind: "none",
    });
  });

  it("accepts only the closed verified marker", () => {
    expect(parseEmailChangeCallback(new URLSearchParams("emailChange=verified"))).toEqual({
      kind: "verified",
    });
    expect(parseEmailChangeCallback(new URLSearchParams("emailChange=success"))).toEqual({
      kind: "invalid",
    });
    expect(parseEmailChangeCallback(new URLSearchParams("emailChange="))).toEqual({
      kind: "invalid",
    });
  });

  it("maps Better Auth errors through a finite closed state set", () => {
    expect(parseEmailChangeCallback(new URLSearchParams("error=token_expired"))).toEqual({
      kind: "expired",
    });
    expect(parseEmailChangeCallback(new URLSearchParams("error=unauthorized"))).toEqual({
      kind: "unauthorized",
    });
    for (const error of ["invalid_token", "user_not_found", "future_error", ""]) {
      expect(parseEmailChangeCallback(new URLSearchParams(`error=${error}`))).toEqual({
        kind: "invalid",
      });
    }
  });

  it("gives one provider error precedence while rejecting duplicate owned parameters", () => {
    expect(
      parseEmailChangeCallback(
        new URLSearchParams("emailChange=verified&error=token_expired"),
      ),
    ).toEqual({ kind: "expired" });
    expect(
      parseEmailChangeCallback(
        new URLSearchParams("emailChange=unknown&error=unauthorized"),
      ),
    ).toEqual({ kind: "unauthorized" });
    expect(
      parseEmailChangeCallback(
        new URLSearchParams(
          "emailChange=verified&emailChange=unknown&error=token_expired",
        ),
      ),
    ).toEqual({ kind: "expired" });
    expect(
      parseEmailChangeCallback(
        new URLSearchParams("emailChange=verified&emailChange=verified"),
      ),
    ).toEqual({ kind: "invalid" });
    expect(
      parseEmailChangeCallback(
        new URLSearchParams("error=token_expired&error=unauthorized"),
      ),
    ).toEqual({ kind: "invalid" });
  });

  it("removes only callback-owned parameters and preserves the query order and hash", () => {
    const url = new URL(
      "https://market.example/account/logs?range=7d&emailChange=verified&application=Desk&error=invalid_token&application=Web#request-9",
    );

    expect(withoutEmailChangeCallback(url)).toBe(
      "/account/logs?range=7d&application=Desk&application=Web#request-9",
    );
  });
});
