const DEFAULT_STARS = "0";

export async function getFormattedGitHubStars(): Promise<string> {
  try {
    const response = await fetch("/api/github-stars", {
      headers: {
        "Cache-Control": "max-age=3600"
      }
    });

    if (!response.ok) {
      return DEFAULT_STARS;
    }

    const data = await response.json();
    return data.stars || DEFAULT_STARS;
  } catch {
    return DEFAULT_STARS;
  }
}
