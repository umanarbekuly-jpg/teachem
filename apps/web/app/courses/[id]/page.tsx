import { CourseDetail } from "@/components/public-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CourseDetail id={(await params).id} />;
}
