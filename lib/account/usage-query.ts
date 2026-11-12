type UsageFilterSelection = {
  range: string;
  keyId: string;
  appUrl: string;
  resourceId: string;
  routeId: string;
  completion: string;
};

export function buildLogsQuery(
  scope: "account" | "admin",
  selection: UsageFilterSelection & { cursor: string | null },
) {
  const params = new URLSearchParams({ range: selection.range, limit: "50" });
  if (scope === "admin") params.set("view", "logs");
  if (selection.cursor) params.set("cursor", selection.cursor);
  if (selection.keyId !== "all") params.set("key", selection.keyId);
  if (selection.appUrl !== "all") params.set("app", selection.appUrl);
  if (selection.resourceId !== "all") params.set("resource", selection.resourceId);
  if (selection.routeId !== "all") params.set("route", selection.routeId);
  if (selection.completion !== "all") {
    params.set("completion", selection.completion);
  }
  return params.toString();
}
