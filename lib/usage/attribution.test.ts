import { describe, expect, it } from "vitest";
import { parseMarketAppAttribution } from "./attribution";

describe("Market application attribution", () => {
  it("normalizes the URL and optional NFC title", () => {
    const headers = headerValues({
      "http-referer": "HTTPS://Example.COM:443/a/../client?secret=1#fragment",
      "x-title": "  Cafe\u0301  ",
    });
    expect(parseMarketAppAttribution(headers)).toEqual({
      url: "https://example.com/client",
      title: "Café",
    });
  });

  it("keeps a valid URL without a title", () => {
    expect(
      parseMarketAppAttribution(new Headers({ "HTTP-Referer": "https://example.com/app/" })),
    ).toEqual({ url: "https://example.com/app/", title: null });
  });

  it.each([
    new Headers({ "X-Title": "Title only" }),
    new Headers({ "HTTP-Referer": "javascript:alert(1)" }),
    headerValues({ "http-referer": " https://example.com" }),
    new Headers({ "HTTP-Referer": "https://example.com", "X-Title": "one,two" }),
  ])("fails malformed attribution open to no attribution", (headers) => {
    expect(parseMarketAppAttribution(headers)).toEqual({ url: null, title: null });
  });

  it("fails duplicate, control-bearing, and oversized attribution open", () => {
    const duplicate = new Headers();
    duplicate.append("HTTP-Referer", "https://one.example/");
    duplicate.append("HTTP-Referer", "https://two.example/");
    expect(parseMarketAppAttribution(duplicate)).toEqual({ url: null, title: null });
    expect(
      parseMarketAppAttribution(
        headerValues({ "http-referer": "https://example.com/\u007fhidden" }),
      ),
    ).toEqual({ url: null, title: null });
    expect(
      parseMarketAppAttribution(
        headerValues({
          "http-referer": `https://example.com/${"a".repeat(2_100)}`,
        }),
      ),
    ).toEqual({ url: null, title: null });
  });

  it("enforces title scalar and UTF-8 byte limits", () => {
    expect(
      parseMarketAppAttribution(
        headerValues({
          "http-referer": "https://example.com/",
          "x-title": "x".repeat(128),
        }),
      ),
    ).toEqual({ url: "https://example.com/", title: "x".repeat(128) });
    expect(
      parseMarketAppAttribution(
        headerValues({
          "http-referer": "https://example.com/",
          "x-title": "x".repeat(129),
        }),
      ),
    ).toEqual({ url: null, title: null });
  });
});

function headerValues(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  } as Headers;
}
