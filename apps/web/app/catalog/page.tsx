import { Catalog } from "@/components/catalog";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  return <Catalog initialSubject={(await searchParams).subject} />;
}
