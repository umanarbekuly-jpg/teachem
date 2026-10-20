"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { userApi, FieldError, type ManagedUser } from "@/lib/api-client/users";
import { uploadFile } from "@/lib/api-client";
import { date, statusLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { Empty, ErrorBox, Loading, Pagination } from "./common";
type Values = {
  name: string;
  surname: string;
  email: string;
  phone: string;
  bio: string;
  experienceYears: number;
  education: string;
  subjects: string;
  languages: string;
  role: "student" | "tutor";
  password: string;
};
const blank: Values = {
  name: "",
  surname: "",
  email: "",
  phone: "",
  bio: "",
  experienceYears: 0,
  education: "",
  subjects: "",
  languages: "",
  role: "student",
  password: "",
};
const passwordRules = {
  required: "Укажите пароль",
  minLength: { value: 12, message: "Не менее 12 символов" },
  validate: (v: string) =>
    new TextEncoder().encode(v).length <= 72 || "Не более 72 байт",
};
export function UserManagement() {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [role, setRole] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<string>(),
    [notice, setNotice] = useState("");
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["managed-users", page, search, role, status],
    queryFn: () =>
      userApi.list(
        new URLSearchParams({
          page: String(page),
          pageSize: "20",
          ...(search ? { search } : {}),
          ...(role ? { role } : {}),
          ...(status ? { status } : {}),
        }),
      ),
  });
  async function refresh(message: string) {
    setNotice(message);
    await cache.invalidateQueries({ queryKey: ["managed-users"] });
  }
  if (selected)
    return (
      <UserEditor
        key={selected}
        id={selected}
        close={() => setSelected(undefined)}
        saved={refresh}
      />
    );
  return (
    <>
      <div className="actions">
        <h1>Пользователи</h1>
        <Button
          onClick={() => {
            setNotice("");
            setSelected("new");
          }}
        >
          Создать аккаунт
        </Button>
      </div>
      <p className="subheading">Аккаунты, профили и доступ к TeachEm</p>
      {notice && <p role="status">{notice}</p>}
      <div className="user-filters">
        <label className="field">
          Поиск по имени или email
          <input
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Имя или email"
          />
        </label>
        <label className="field">
          Роль
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все роли</option>
            <option value="student">Студент</option>
            <option value="tutor">Тьютор</option>
            <option value="SUPERADMIN">Суперадминистратор</option>
          </select>
        </label>
        <label className="field">
          Статус
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все статусы</option>
            <option value="active">Активен</option>
            <option value="blocked">Заблокирован</option>
          </select>
        </label>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data && (
        <>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Таблица пользователей"
          >
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Email</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Регистрация</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name} {u.surname}
                    </td>
                    <td>{u.email}</td>
                    <td>{statusLabel[u.role]}</td>
                    <td>
                      {u.blockedAt ? "Заблокирован" : "Активен"}
                      {u.mustChangePassword && (
                        <small className="user-note">Нужна смена пароля</small>
                      )}
                    </td>
                    <td>{date(u.createdAt)}</td>
                    <td>
                      <Button
                        variant="outline"
                        onClick={() => setSelected(u.id)}
                      >
                        {u.role === "SUPERADMIN"
                          ? "Просмотреть"
                          : "Редактировать"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.data.items.length && <Empty title="Пользователи не найдены" />}
          <Pagination page={page} total={q.data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}
function UserEditor({
  id,
  close,
  saved,
}: {
  id: string;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const q = useQuery({
    queryKey: ["managed-user", id],
    queryFn: () => userApi.get(id),
    enabled: id !== "new",
  });
  if (id !== "new" && !q.data)
    return (
      <>
        <Button variant="outline" onClick={close}>
          К списку
        </Button>
        <ErrorBox error={q.error} />
        {q.isLoading && <Loading />}
      </>
    );
  return (
    <>
      <Button variant="outline" onClick={close}>
        ← Все пользователи
      </Button>
      <h1>
        {id === "new" ? "Новый аккаунт" : q.data!.name + " " + q.data!.surname}
      </h1>
      {q.data?.role === "SUPERADMIN" ? (
        <div className="panel">
          <p>{q.data.email} · Суперадминистратор</p>
          <p>
            Единственный суперадминистратор защищён от блокировки, удаления и
            смены роли.
          </p>
          <a href="/change-password">Сменить свой пароль</a>
        </div>
      ) : (
        <>
          <ProfileForm
            user={q.data}
            saved={async () => {
              if (id !== "new") await q.refetch();
              await saved(
                id === "new"
                  ? "Аккаунт создан. При первом входе потребуется смена пароля."
                  : "Изменения сохранены",
              );
              if (id === "new") close();
            }}
          />
          {q.data && (
            <AccountActions
              user={q.data}
              saved={async () => {
                await q.refetch();
                await saved("Изменения сохранены");
              }}
            />
          )}
        </>
      )}
    </>
  );
}
function ProfileForm({
  user,
  saved,
}: {
  user?: ManagedUser;
  saved: () => Promise<void>;
}) {
  const [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(""),
    [photo, setPhoto] = useState<File>(),
    [removePhoto, setRemovePhoto] = useState(false);
  const form = useForm<Values>({
    defaultValues: user
      ? {
          ...blank,
          ...user,
          role: user.role === "tutor" ? "tutor" : "student",
          bio: user.profile?.bio ?? user.bio,
          education: user.profile?.education ?? "",
          experienceYears: user.profile?.experienceYears ?? 0,
          subjects: user.profile?.subjects.join(", ") ?? "",
          languages: user.profile?.languages.join(", ") ?? "",
        }
      : blank,
  });
  const tutor = user
    ? user.role === "tutor" || !!user.profile
    : form.watch("role") === "tutor";
  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    setNotice("");
    try {
      const photoAssetId = photo
        ? await uploadFile(photo, "avatar")
        : removePhoto
          ? null
          : undefined;
      const body = {
        name: v.name,
        surname: v.surname,
        email: v.email,
        phone: v.phone,
        bio: v.bio,
        ...(photoAssetId !== undefined ? { photoAssetId } : {}),
        ...(tutor
          ? {
              education: v.education,
              experienceYears: Number(v.experienceYears),
              subjects: v.subjects
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              languages: v.languages
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      };
      if (user) await userApi.update(user.id, body);
      else
        await userApi.create({ ...body, role: v.role, password: v.password });
      form.setValue("password", "");
      setPhoto(undefined);
      setNotice("Профиль сохранён");
      await saved();
    } catch (e) {
      setError(e);
      if (e instanceof FieldError)
        for (const [key, message] of Object.entries(e.fields))
          form.setError(key as keyof Values, { message });
    }
  });
  function input(
    key: Exclude<keyof Values, "experienceYears">,
    label: string,
    type = "text",
    required = false,
    maxLength = 100,
  ) {
    return (
      <label className="field" key={key}>
        {label}
        <input
          type={type}
          autoComplete={key === "password" ? "new-password" : undefined}
          {...form.register(
            key,
            key === "password"
              ? passwordRules
              : {
                  required: required ? "Обязательное поле" : false,
                  maxLength: {
                    value: maxLength,
                    message: "Слишком длинное значение",
                  },
                  ...(key === "name"
                    ? {
                        validate: (v) =>
                          String(v).trim().length >= 2 || "Не менее 2 символов",
                      }
                    : {}),
                },
          )}
        />
        <span className="field-error">
          {form.formState.errors[key]?.message}
        </span>
      </label>
    );
  }
  return (
    <form className="panel form-stack" onSubmit={submit}>
      <h2>Профиль</h2>
      <div className="user-form-grid">
        {input("name", "Имя", "text", true)}
        {input("surname", "Фамилия")}
        {input("email", "Email", "email", true, 254)}
        {input("phone", "Телефон", "tel", false, 40)}
      </div>
      {user && (
        <small>
          {user.emailVerifiedAt ? "Email подтверждён" : "Email не подтверждён"}.
          Смена email сбросит подтверждение и завершит сессии.
        </small>
      )}
      {!user && (
        <>
          <label className="field">
            Роль
            <select {...form.register("role")}>
              <option value="student">Студент</option>
              <option value="tutor">Тьютор</option>
            </select>
          </label>
          {input("password", "Начальный пароль", "password", true)}
          <small>
            Пользователь должен сменить начальный пароль при первом входе.
          </small>
        </>
      )}
      <label className="field">
        Описание
        <textarea
          rows={4}
          {...form.register("bio", {
            maxLength: { value: 5000, message: "Не более 5000 символов" },
          })}
        />
        <span className="field-error">
          {form.formState.errors.bio?.message}
        </span>
      </label>
      <label className="field">
        Фото{" "}
        {user?.photoUrl && !removePhoto && (
          <a href={user.photoUrl} target="_blank" rel="noreferrer">
            Открыть текущее фото
          </a>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            setPhoto(e.target.files?.[0]);
            setRemovePhoto(false);
          }}
        />
        <small>PNG, JPG или WebP, до 20 МБ</small>
      </label>
      {(user?.photoAssetId || user?.profile?.photoAssetId) && (
        <label>
          <input
            type="checkbox"
            checked={removePhoto}
            onChange={(e) => {
              setRemovePhoto(e.target.checked);
              setPhoto(undefined);
            }}
          />{" "}
          Удалить фото из профиля
        </label>
      )}
      {tutor && (
        <fieldset className="form-stack">
          <legend>Профиль тьютора (сохраняется при смене роли)</legend>
          <label className="field">
            Опыт, лет
            <input
              type="number"
              min={0}
              max={80}
              {...form.register("experienceYears", {
                valueAsNumber: true,
                min: { value: 0, message: "От 0 до 80" },
                max: { value: 80, message: "От 0 до 80" },
              })}
            />
            <span className="field-error">
              {form.formState.errors.experienceYears?.message}
            </span>
          </label>
          {input("education", "Образование", "text", false, 2000)}
          {input("subjects", "Предметы через запятую", "text", false, 2000)}
          {input("languages", "Языки через запятую", "text", false, 2000)}
        </fieldset>
      )}
      <ErrorBox error={error} />
      {notice && <p role="status">{notice}</p>}
      <Button disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting
          ? "Сохраняем…"
          : user
            ? "Сохранить профиль"
            : "Создать аккаунт"}
      </Button>
    </form>
  );
}
function AccountActions({
  user,
  saved,
}: {
  user: ManagedUser;
  saved: () => Promise<void>;
}) {
  const [role, setRole] = useState(user.role),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const form = useForm<{ newPassword: string; confirmPassword: string }>();
  async function action(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await work();
      await saved();
      setNotice(message);
    } catch (e) {
      setError(e);
      if (e instanceof FieldError && e.fields.confirmPassword)
        form.setError("confirmPassword", { message: e.fields.confirmPassword });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-stack">
      <h2>Доступ к аккаунту</h2>
      <label className="field">
        Роль
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as ManagedUser["role"])}
        >
          <option value="student">Студент</option>
          <option value="tutor">Тьютор</option>
        </select>
      </label>
      <Button
        variant="outline"
        disabled={busy || role === user.role}
        onClick={() => {
          if (
            window.confirm(
              "Изменить роль пользователя " +
                user.name +
                " (" +
                user.email +
                ")? Все его сессии будут завершены.",
            )
          )
            void action(
              () => userApi.role(user.id, role),
              "Роль изменена. Пользователю нужно войти заново.",
            );
        }}
      >
        Изменить роль
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              (user.blockedAt ? "Разблокировать " : "Заблокировать ") +
                user.name +
                "?",
            )
          )
            void action(
              () => userApi.block(user.id, !user.blockedAt),
              "Статус изменён",
            );
        }}
      >
        {user.blockedAt ? "Разблокировать" : "Заблокировать"}
      </Button>
      <form
        className="form-stack"
        onSubmit={form.handleSubmit(async (v) => {
          if (
            window.confirm(
              "Задать новый пароль для " +
                user.name +
                " (" +
                user.email +
                ")? Все сессии завершатся; при входе потребуется сменить пароль.",
            )
          )
            await action(async () => {
              await userApi.reset(user.id, v);
              form.reset();
            }, "Пароль назначен. Передайте его пользователю безопасным способом.");
        })}
      >
        <h3>Задать новый пароль</h3>
        <label className="field">
          Новый пароль
          <input
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword", passwordRules)}
          />
          <span className="field-error">
            {form.formState.errors.newPassword?.message}
          </span>
        </label>
        <label className="field">
          Подтверждение пароля
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
        <Button disabled={busy}>Задать новый пароль</Button>
      </form>
      <ErrorBox error={error} />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
