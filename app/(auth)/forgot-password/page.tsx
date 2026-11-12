import ForgotPasswordForm from "./forgot-password-form";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-64" aria-hidden="true" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
