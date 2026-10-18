import { AuthForm } from "@/components/auth-form";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const q = await searchParams;
  return (
    <AuthForm
      registerMode
      initialRole={q.role === "tutor" ? "tutor" : "student"}
    />
  );
}
