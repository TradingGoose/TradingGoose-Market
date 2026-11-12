export type MarketAppAttribution = {
  url: string | null;
  title: string | null;
};

const utf8 = new TextEncoder();
const URL_MAX_BYTES = 2_048;
const TITLE_MAX_BYTES = 512;
const TITLE_MAX_SCALARS = 128;

export function parseMarketAppAttribution(headers: Headers): MarketAppAttribution {
  const referer = headers.get("http-referer");
  const rawTitle = headers.get("x-title");
  if (referer === null && rawTitle === null) return { url: null, title: null };
  if (referer === null) return { url: null, title: null };

  try {
    if (
      referer.length === 0 ||
      referer !== referer.trim() ||
      containsHeaderControl(referer) ||
      referer.includes(",") ||
      utf8.encode(referer).byteLength > URL_MAX_BYTES
    ) {
      return { url: null, title: null };
    }

    const parsed = new URL(referer);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: null, title: null };
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    const url = parsed.toString();
    if (utf8.encode(url).byteLength > URL_MAX_BYTES) return { url: null, title: null };

    if (rawTitle === null) return { url, title: null };
    if (rawTitle.includes(",") || containsTitleControl(rawTitle)) {
      return { url: null, title: null };
    }
    const title = rawTitle.trim().normalize("NFC");
    if (
      title.length === 0 ||
      Array.from(title).length > TITLE_MAX_SCALARS ||
      utf8.encode(title).byteLength > TITLE_MAX_BYTES
    ) {
      return { url: null, title: null };
    }
    return { url, title };
  } catch {
    return { url: null, title: null };
  }
}

export function appDisplayName(attribution: MarketAppAttribution) {
  if (!attribution.url) return "Unattributed";
  if (attribution.title) return attribution.title;
  const url = new URL(attribution.url);
  return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
}

function containsHeaderControl(value: string) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function containsTitleControl(value: string) {
  return /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);
}
