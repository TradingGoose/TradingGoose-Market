import { LogsPage } from "@/components/account/logs/logs-page";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export default function LogsRoutePage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-[32rem]" aria-hidden="true" />}>
      <LogsPage />
    </Suspense>
  );
}
