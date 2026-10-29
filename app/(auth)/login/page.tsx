import LoginForm from "./login-form";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { getMarketRuntimeConfig } from "@/lib/environment";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-80" aria-hidden="true" />}>
      <LoginForm registrationOpen={getMarketRuntimeConfig().registrationMode === "open"} />
    </Suspense>
  );
}
