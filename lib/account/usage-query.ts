export type UsageFilterSelection = {
  range: string;
  keyId: string;
  appUrl: string;
  resourceId: string;
  routeId: string;
  completion: string;
};

export type AdminUsageQuerySelection = UsageFilterSelection & {
  view: "activity" | "logs";
  cursor: string | null;
};

export function buildAdminUsageQuery(selection: AdminUsageQuerySelection) {
  const params = new URLSearchParams({
    view: selection.view,
    range: selection.range,
  });
  if (selection.view === "activity") {
    params.set("granularity", selection.range === "24h" ? "hour" : "day");
  } else {
    params.set("limit", "50");
    if (selection.cursor) params.set("cursor", selection.cursor);
  }
  appendSelectedFilters(params, selection);
  return params.toString();
}

export function buildCustomerLogsQuery(
  selection: UsageFilterSelection & { cursor: string | null },
) {
  const params = new URLSearchParams({ range: selection.range, limit: "50" });
  if (selection.cursor) params.set("cursor", selection.cursor);
  appendSelectedFilters(params, selection);
  return params.toString();
}

function appendSelectedFilters(
  params: URLSearchParams,
  selection: UsageFilterSelection,
) {
  if (selection.keyId !== "all") params.set("key", selection.keyId);
  if (selection.appUrl !== "all") params.set("app", selection.appUrl);
  if (selection.resourceId !== "all") params.set("resource", selection.resourceId);
  if (selection.routeId !== "all") params.set("route", selection.routeId);
  if (selection.completion !== "all") {
    params.set("completion", selection.completion);
  }
}
