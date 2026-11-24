import { describe, expect, it } from "vitest";

import {
  appDisplayName,
  parseMarketAppAttribution,
} from "../../lib/usage/attribution";

describe("immutable request application attribution", () => {
  it("normalizes the URL, strips credentials/query/fragment, and NFC-normalizes the title", () => {
    const value = parseMarketAppAttribution(
      headerValues({
        "http-referer": "https://user:secret@Example.COM:443/a/../client?token=secret#fragment",
        "x-title": "  Cafe\u0301  ",
      }),
    );

    expect(value).toEqual({ url: "https://example.com/client", title: "Café" });
    expect(appDisplayName(value)).toBe("Café");
  });

  it("keeps URL-only attribution and renders absent attribution explicitly", () => {
    const urlOnly = parseMarketAppAttribution(
      new Headers({ "HTTP-Referer": "https://example.com/portfolio/" }),
    );
    expect(urlOnly).toEqual({ url: "https://example.com/portfolio/", title: null });
    expect(appDisplayName(urlOnly)).toBe("example.com/portfolio/");
    expect(appDisplayName({ url: null, title: null })).toBe("Unattributed");
  });

  it.each([
    new Headers({ "X-Title": "title without URL" }),
    new Headers({ "HTTP-Referer": "file:///tmp/app" }),
    headerValues({ "http-referer": " https://example.com/" }),
    new Headers({ "HTTP-Referer": "https://example.com/", "X-Title": "one,two" }),
    new Headers({ "HTTP-Referer": `https://example.com/${"x".repeat(2_100)}` }),
    new Headers({ "HTTP-Referer": "https://example.com/", "X-Title": "x".repeat(129) }),
  ])("fails an invalid optional attribution open to Unattributed", (headers) => {
    expect(parseMarketAppAttribution(headers)).toEqual({ url: null, title: null });
  });
});

function headerValues(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  } as Headers;
}
