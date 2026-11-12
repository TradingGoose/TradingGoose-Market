import { redirect } from "next/navigation";

import { getMarketRuntimeConfig } from "@/lib/environment";
import VerifyForm from "./verify-form";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  if (!getMarketRuntimeConfig().betterAuth.emailVerificationEnabled) redirect("/account/api-keys");
  return <VerifyForm />;
}
