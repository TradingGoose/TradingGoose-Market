export type ApiKeyStatus = "available" | "revocation_pending" | "revoked";

export type ApiKeyRevocationOutcome =
  | { status: "revoked"; retryable: false }
  | { status: "revocation_pending"; retryable: true };

export type MarketApiKeySummary = {
  id: string;
  name: string;
  displayValue: string;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  totalRequestCount: number;
  spendLimitUsd: string | null;
  spendWindowDays: number | null;
  rollingBillableCostUsd: string | null;
};

export type ProviderEnforcement = {
  status: "unlimited" | "disabled" | "unobserved" | "stale" | "current";
  remainingUsdUpperBound: string | null;
  resetAt: string | null;
  decision: "allowed" | "rate_limited" | null;
  observedRevision: number | null;
  observedAt: string | null;
  mayBeMoreRestrictive: boolean;
};

export type MarketApiKeyDetail = MarketApiKeySummary & {
  spendLimitRevision: number;
  rollingWindowRequestCount: number | null;
  ledgerRemainingUsd: string | null;
  ledgerNextCostEligibleAt: string | null;
  providerEnforcement: ProviderEnforcement;
};

export type BillingSummary = {
  billingEnabled: boolean;
  plan: "payg";
  rateUsdPer1000Reads: string;
  currentPeriodRequestQuantity: number;
  currentPeriodCostUsd: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  customerRecoveryState: "ready" | "settlement_pending" | "unavailable";
  activationAvailable: boolean;
  portalAvailable: boolean;
};

export type UsageBucket = {
  timestamp: string;
  requests: number;
  successes: number;
  errors: number;
};

export type UsageBreakdown = {
  id: string;
  label: string;
  requests: number;
};

export type UsageFacet = {
  id: string;
  label: string;
};

export type UsageFacets = {
  keys: UsageFacet[];
  applications: UsageFacet[];
  resources: UsageFacet[];
  endpoints: UsageFacet[];
};

export type UsageSeriesPoint = {
  timestamp: string;
  seriesId: string;
  seriesLabel: string;
  requests: number;
  successes: number;
  errors: number;
};

export type ActivityResponse = {
  totalRequests: number;
  completedSuccessCount: number;
  completedErrorCount: number;
  pendingCount: number;
  activeKeyCount: number;
  comparisonDeltaPercent: number | null;
  buckets: UsageBucket[];
  topKeys: UsageBreakdown[];
  topApplications: UsageBreakdown[];
  topResources: UsageBreakdown[];
  topEndpoints: UsageBreakdown[];
  series: UsageSeriesPoint[];
  facets: UsageFacets;
};

export type UsageLogRow = {
  id: string;
  admittedAt: string;
  requestedResourceId: string;
  requestedResourceLabel: string;
  routeId: string;
  category: string;
  method: string;
  version: string;
  keyId: string;
  keyName: string;
  keyDisplayValue: string;
  keyStatus: ApiKeyStatus;
  applicationUrl: string | null;
  applicationTitle: string | null;
  completionStatus: "success" | "client_error" | "server_error" | "pending";
  httpStatus: number | null;
  completedAt: string | null;
};

export type LogsResponse = {
  rows: UsageLogRow[];
  histogram: UsageBucket[];
  nextCursor: string | null;
  facets: UsageFacets;
};

export type AdminUsageResponse =
  | { view: "activity"; data: ActivityResponse }
  | { view: "logs"; data: LogsResponse };

export type AdminApiKeySummary = {
  id: string;
  name: string;
  displayValue: string;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  totalRequestCount: number;
  originatingAdminName: string;
  originatingAdminEmail: string;
  grantStatus: "active" | "removing" | "removed";
};
