import { ApiKeyDetailPage } from "@/components/account/api-keys/api-key-detail-page";

export default async function ApiKeyDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApiKeyDetailPage id={id} />;
}
