import { ActivityPage } from "@/components/account/activity/activity-page";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export default function ActivityRoutePage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-[32rem]" aria-hidden="true" />}>
      <ActivityPage />
    </Suspense>
  );
}
