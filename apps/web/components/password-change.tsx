"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, result } from "@/lib/api-client";
import { accountRequest } from "@/lib/api-client/users";
import { accountPath } from "@/lib/account";
import { Button } from "./ui/button";
import { ErrorBox, Loading, Logo } from "./common";
export function PasswordChange() {
  const router = useRouter(),
    cache = useQueryClient(),
    [error, setError] = useState<unknown>();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => result(api.GET("/api/v1/auth/me")),
    retry: false,
  });
  const form = useForm<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>();
  if (me.isLoading) return <Loading />;
  if (!me.data)
    return (
      <main className="container section">
        <ErrorBox error={me.error} />
        <Link href="/login">Войти</Link>
      </main>
    );
  async function logout() {
    try {
      await result(api.POST("/api/v1/auth/logout"));
      cache.clear();
      router.replace("/login");
    } catch (e) {
      setError(e);
    }
  }
  return (
    <main className="container section" style={{ maxWidth: 580 }}>
      <Logo />
      <h1>Сменить пароль</h1>
      <p>
        {me.data.mustChangePassword
          ? "Перед продолжением замените назначенный пароль своим."
          : "Подтвердите текущий пароль, чтобы задать новый."}
      </p>
      <form
        className="form-stack panel"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            setError(undefined);
            await accountRequest("auth/change-password", "POST", values);
            cache.clear();
            router.replace("/login?passwordChanged=1");
          } catch (e) {
            setError(e);
          }
        })}
      >
        <label className="field">
          Текущий или назначенный пароль
          <input
            type="password"
            autoComplete="current-password"
            {...form.register("currentPassword", {
              required: "Введите текущий пароль",
            })}
          />
          <span className="field-error">
            {form.formState.errors.currentPassword?.message}
          </span>
        </label>
        <label className="field">
          Новый пароль
          <input
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword", {
              required: "Введите новый пароль",
              minLength: { value: 12, message: "Не менее 12 символов" },
              validate: (v) =>
                new TextEncoder().encode(v).length <= 72 || "Не более 72 байт",
            })}
          />
          <span className="field-error">
            {form.formState.errors.newPassword?.message}
          </span>
        </label>
        <label className="field">
          Повторите новый пароль
          <input
            type="password"
            autoComplete="new-password"
            {...form.register("confirmPassword", {
              validate: (v) =>
                v === form.getValues("newPassword") || "Пароли не совпадают",
            })}
          />
          <span className="field-error">
            {form.formState.errors.confirmPassword?.message}
          </span>
        </label>
        <ErrorBox error={error} />
        <Button disabled={form.formState.isSubmitting}>
          Сохранить и войти заново
        </Button>
      </form>
      <div className="actions">
        {!me.data.mustChangePassword && (
          <Link href={accountPath(me.data)}>В кабинет</Link>
        )}
        <Button variant="outline" onClick={logout}>
          Выйти
        </Button>
      </div>
    </main>
  );
}
