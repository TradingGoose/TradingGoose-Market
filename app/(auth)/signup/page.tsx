import { notFound } from "next/navigation";

import { getMarketRuntimeConfig } from "@/lib/environment";
import SignupForm from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const config = getMarketRuntimeConfig();
  if (config.registrationMode !== "open") notFound();
  return <SignupForm emailVerificationEnabled={config.betterAuth.emailVerificationEnabled} />;
}
