import { Unsubscribe } from "@/components/billing/unsubscribe";

export default async function UnsubscribePage({ searchParams }: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email, token } = await searchParams;
  return <Unsubscribe key={`${email}:${token}`} email={email ?? ""} token={token ?? ""} />;
}
