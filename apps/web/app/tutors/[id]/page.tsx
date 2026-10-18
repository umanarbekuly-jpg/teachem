import { TutorDetail } from "@/components/public-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <TutorDetail id={(await params).id} />;
}
