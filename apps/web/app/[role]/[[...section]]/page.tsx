import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
export default async function Page({
  params,
}: {
  params: Promise<{ role: string; section?: string[] }>;
}) {
  const p = await params;
  if (p.role !== "student" && p.role !== "tutor" && p.role !== "admin")
    notFound();
  if (!p.section?.length)
    redirect(`/${p.role}/${p.role === "admin" ? "payments" : "courses"}`);
  return <Dashboard role={p.role} section={p.section} />;
}
