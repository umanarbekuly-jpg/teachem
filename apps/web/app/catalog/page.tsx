import { Catalog } from "@/components/catalog";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    tag?: string;
    search?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const p = await searchParams;
  return (
    <Catalog
      key={JSON.stringify(p)}
      initialSubject={p.subject}
      initialTag={p.tag}
      initialSearch={p.search}
      initialFrom={p.from}
      initialTo={p.to}
    />
  );
}
