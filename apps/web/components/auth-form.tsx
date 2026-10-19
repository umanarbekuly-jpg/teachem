"use client";
import { BRAND } from "@tutor/shared";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { api, result } from "@/lib/api-client";
import { Button } from "./ui/button";
import { ErrorBox, Logo } from "./common";
const schema = z.object({
  email: z.email("Укажите email"),
  password: z
    .string()
    .min(12, "Не менее 12 символов")
    .max(72, "Не более 72 символов"),
  name: z.string().optional(),
});
export function AuthForm({
  registerMode = false,
  initialRole = "student",
}: {
  registerMode?: boolean;
  initialRole?: "student" | "tutor";
}) {
  const router = useRouter();
  const cache = useQueryClient();
  const [role, setRole] = useState(initialRole);
  const [error, setError] = useState<unknown>();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      setError(undefined);
      if (registerMode && (!values.name || values.name.trim().length < 2)) {
        form.setError("name", { message: "Укажите имя (от 2 символов)" });
        return;
      }
      const user = registerMode
        ? await result(
            api.POST("/api/v1/auth/register", {
              body: { ...values, name: values.name!, role },
            }),
          )
        : await result(
            api.POST("/api/v1/auth/login", {
              body: { email: values.email, password: values.password },
            }),
          );
      cache.setQueryData(["me"], user);
      router.replace(`/${user.role}`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow">{BRAND.tagline}</span>
          <h1>
            Ваш следующий
            <br />
            шаг начинается
            <br />
            здесь.
          </h1>
          <p>
            Хороший наставник помогает увидеть возможности. А мы помогаем вам
            встретиться.
          </p>
        </div>
        <span>Учиться сегодня. Расти каждый день.</span>
      </aside>
      <main className="auth-main">
        <div className="auth-form">
          <h1>{registerMode ? "Начнём знакомство" : "С возвращением"}</h1>
          <p>
            {registerMode
              ? "Создайте аккаунт, чтобы двигаться вперёд."
              : "Войдите, чтобы продолжить обучение."}
          </p>
          <form onSubmit={submit} className="form-stack">
            {registerMode && (
              <>
                <div className="role-selector">
                  <button
                    type="button"
                    className={role === "student" ? "selected" : ""}
                    onClick={() => setRole("student")}
                  >
                    Я ученик
                  </button>
                  <button
                    type="button"
                    className={role === "tutor" ? "selected" : ""}
                    onClick={() => setRole("tutor")}
                  >
                    Я тьютор
                  </button>
                </div>
                <label className="field">
                  Имя и фамилия
                  <input autoComplete="name" {...form.register("name")} />
                  <span className="field-error">
                    {form.formState.errors.name?.message}
                  </span>
                </label>
              </>
            )}
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...form.register("email")}
              />
              <span className="field-error">
                {form.formState.errors.email?.message}
              </span>
            </label>
            <label className="field">
              Пароль
              <input
                type="password"
                autoComplete={
                  registerMode ? "new-password" : "current-password"
                }
                {...form.register("password")}
              />
              <span className="field-error">
                {form.formState.errors.password?.message}
              </span>
              {registerMode && <small>От 12 символов</small>}
            </label>
            <ErrorBox error={error} />
            <Button disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? "Подождите…"
                : registerMode
                  ? "Создать аккаунт"
                  : "Войти"}
            </Button>
          </form>
          <div className="auth-switch">
            {registerMode ? "Уже есть аккаунт?" : "Ещё нет аккаунта?"}{" "}
            <Link href={registerMode ? "/login" : "/register"}>
              {registerMode ? "Войти" : "Зарегистрироваться"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
