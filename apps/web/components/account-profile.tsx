"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { accountRequest, FieldError } from "@/lib/api-client/users";
import { Button } from "./ui/button";
import { ErrorBox } from "./common";
import { PasswordChangeForm } from "./password-change";
import { ProfilePanel } from "./management";

type Profile = { name: string; surname: string; email: string; role: string };
type Values = {
  name: string;
  surname: string;
  email: string;
  currentPassword: string;
};
const roles: Record<string, string> = {
  student: "Ученик",
  tutor: "Тьютор",
  SUPERADMIN: "Суперадминистратор",
};

export function AccountProfile({ user }: { user: Profile }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="account-profile">
      <h1>Мой профиль</h1>
      <p className="subheading">Личные данные и безопасность аккаунта.</p>
      <section className="panel" aria-label="Личные данные">
        {message && <p role="status">{message}</p>}
        {editing ? (
          <ProfileEdit
            user={user}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              cache.setQueryData(["me"], updated);
              void cache.invalidateQueries();
              setEditing(false);
              setMessage(
                `Данные сохранены. Для входа используйте: ${updated.email}`,
              );
            }}
          />
        ) : (
          <>
            <dl className="profile-details">
              <div>
                <dt>Логин / Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Имя</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Фамилия</dt>
                <dd>{user.surname || "Не указана"}</dd>
              </div>
              <div>
                <dt>Роль</dt>
                <dd>{roles[user.role] ?? user.role}</dd>
              </div>
            </dl>
            <Button
              onClick={() => {
                setMessage("");
                setEditing(true);
              }}
            >
              Изменить данные
            </Button>
          </>
        )}
      </section>
      <section aria-label="Безопасность">
        <h2>Безопасность</h2>
        <p>
          После смены пароля все активные сессии завершатся. Войдите заново с
          новым паролем.
        </p>
        <Button
          variant="outline"
          aria-expanded={passwordOpen}
          onClick={() => setPasswordOpen(!passwordOpen)}
        >
          {passwordOpen ? "Отмена смены пароля" : "Сменить пароль"}
        </Button>
        {passwordOpen && <PasswordChangeForm />}
      </section>
      {user.role === "tutor" && <ProfilePanel />}
    </div>
  );
}

function ProfileEdit({
  user,
  onCancel,
  onSaved,
}: {
  user: Profile;
  onCancel: () => void;
  onSaved: (value: Profile) => void;
}) {
  const form = useForm<Values>({
    shouldUnregister: true,
    defaultValues: {
      name: user.name,
      surname: user.surname,
      email: user.email,
      currentPassword: "",
    },
  });
  const [error, setError] = useState<unknown>();
  const emailChanged = form.watch("email").trim().toLowerCase() !== user.email;
  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        setError(undefined);
        try {
          const updated = await accountRequest<Profile>("users/me", "PATCH", {
            name: values.name.trim(),
            surname: values.surname.trim(),
            email: values.email.trim().toLowerCase(),
            ...(emailChanged
              ? { currentPassword: values.currentPassword }
              : {}),
          });
          onSaved(updated);
        } catch (e) {
          if (e instanceof FieldError)
            for (const key of [
              "name",
              "surname",
              "email",
              "currentPassword",
            ] as const) {
              if (e.fields[key]) form.setError(key, { message: e.fields[key] });
            }
          setError(e);
        }
      })}
    >
      <label className="field">
        Имя
        <input
          autoComplete="given-name"
          maxLength={100}
          {...form.register("name", {
            validate: (v) =>
              (v.trim().length >= 2 && v.trim().length <= 100) ||
              "От 2 до 100 символов",
          })}
        />
        <span className="field-error">
          {form.formState.errors.name?.message}
        </span>
      </label>
      <label className="field">
        Фамилия
        <input
          autoComplete="family-name"
          maxLength={100}
          {...form.register("surname", {
            maxLength: { value: 100, message: "Не более 100 символов" },
          })}
        />
        <span className="field-error">
          {form.formState.errors.surname?.message}
        </span>
      </label>
      <label className="field">
        Логин / Email
        <input
          autoComplete="username"
          inputMode="email"
          maxLength={254}
          {...form.register("email", {
            validate: (v) => {
              const email = v.trim().toLowerCase();
              return (
                (email.length <= 254 &&
                  (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
                    (user.role === "SUPERADMIN" &&
                      email === "supadmin@teachem"))) ||
                "Укажите корректный email"
              );
            },
          })}
        />
        <span className="field-error">
          {form.formState.errors.email?.message}
        </span>
      </label>
      {emailChanged && (
        <label className="field">
          Текущий пароль для смены почты
          <input
            type="password"
            autoComplete="current-password"
            {...form.register("currentPassword", {
              validate: (v) =>
                !emailChanged || Boolean(v) || "Введите текущий пароль",
            })}
          />
          <span className="field-error">
            {form.formState.errors.currentPassword?.message}
          </span>
          <small>После сохранения новый email будет вашим логином.</small>
        </label>
      )}
      <p className="muted">Роль: {roles[user.role] ?? user.role}</p>
      <ErrorBox error={error} />
      <div className="actions">
        <Button disabled={form.formState.isSubmitting}>Сохранить</Button>
        <Button
          type="button"
          variant="outline"
          disabled={form.formState.isSubmitting}
          onClick={onCancel}
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}
