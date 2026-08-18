import { NextResponse } from "next/server";
import {
  createManifestMethodPolicy,
  toExplicitHeadResponse,
} from "@/lib/market-api/core/method-guards";

const GITHUB_REPO = "TradingGoose/TradingGoose-Market";
const methods = createManifestMethodPolicy("/api/github-stars");

function formatStarCount(num: number): string {
  if (num < 1000) {
    return String(num);
  }

  const formatted = (Math.round(num / 100) / 10).toFixed(1);
  return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}k` : `${formatted}k`;
}

export async function GET(_request: Request) {
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TradingGoose-Market/1.0",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      next: { revalidate: 3600 },
      cache: "force-cache"
    });

    if (!response.ok) {
      if (!(response.status === 404 && !token)) {
        console.warn("GitHub API request failed:", {
          status: response.status,
          repo: GITHUB_REPO,
          hasToken: Boolean(token)
        });
      }

      return NextResponse.json({ stars: formatStarCount(0) });
    }

    const data = await response.json();
    return NextResponse.json({
      stars: formatStarCount(Number(data?.stargazers_count ?? 0))
    });
  } catch (error) {
    console.warn("Error fetching GitHub stars:", error);
    return NextResponse.json({ stars: formatStarCount(0) });
  }
}

export const HEAD = (request: Request) => toExplicitHeadResponse(GET(request));
export const POST = methods.POST;
export const PUT = methods.PUT;
export const PATCH = methods.PATCH;
export const DELETE = methods.DELETE;
export const OPTIONS = methods.OPTIONS;
