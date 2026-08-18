import ResetPasswordForm from "./reset-password-form";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-64" aria-hidden="true" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
