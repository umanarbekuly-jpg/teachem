"use client";
import { AdminCourses, ManagedCourseEditor } from "./course-editor";
import { accountPath } from "@/lib/account";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  LogOut,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result, downloadFile } from "@/lib/api-client";
import {
  Badge,
  CourseCard,
  Empty,
  ErrorBox,
  Loading,
  Logo,
  Pagination,
} from "./common";
import { Button } from "./ui/button";
import { date, money, statusLabel } from "@/lib/utils";
import { CourseWorkspace, CourseEditor, PaymentScreen } from "./learning";
import { AdminPanel, ProfilePanel } from "./management";
import { TestRunner } from "./tests";
const icons = {
  courses: BookOpen,
  schedule: CalendarDays,
  payments: CircleDollarSign,
  results: ClipboardList,
  students: Users,
  finances: CircleDollarSign,
  profile: UserRound,
  users: Users,
  payouts: CircleDollarSign,
  settings: Settings,
  audit: ClipboardList,
};
const nav: Record<string, [keyof typeof icons, string][]> = {
  student: [
    ["courses", "Мои курсы"],
    ["schedule", "Расписание"],
    ["results", "Результаты тестов"],
    ["payments", "Платежи"],
  ],
  tutor: [
    ["courses", "Мои курсы"],
    ["students", "Ученики"],
    ["schedule", "Расписание"],
    ["finances", "Финансы"],
    ["profile", "Мой профиль"],
  ],
  admin: [
    ["courses", "Курсы"],
    ["payments", "Проверка платежей"],
    ["users", "Пользователи"],
    ["payouts", "Выплаты"],
    ["settings", "Настройки"],
    ["audit", "Журнал действий"],
  ],
};
export function Dashboard({
  role,
  section = [],
}: {
  role: "student" | "tutor" | "admin";
  section?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const cache = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => result(api.GET("/api/v1/auth/me")),
    retry: false,
  });
  const [logoutError, setLogoutError] = useState<unknown>();
  const current = section[0] ?? (role === "admin" ? "payments" : "courses");
  useEffect(() => {
    if (me.data && accountPath(me.data) !== `/${role}`)
      router.replace(accountPath(me.data));
  }, [me.data, role, router]);
  if (me.isLoading) return <Loading />;
  if (me.error)
    return (
      <div className="container section">
        <ErrorBox error={me.error} />
        <Button asChild>
          <Link href="/login">Войти заново</Link>
        </Button>
      </div>
    );
  if (!me.data || accountPath(me.data) !== `/${role}`) return <Loading />;
  const user = me.data;
  let content: React.ReactNode;
  if (role === "admin" && current === "courses" && section[1])
    content = <ManagedCourseEditor id={section[1]} />;
  else if (role === "admin" && current === "courses")
    content = <AdminCourses />;
  else if (role === "admin") content = <AdminPanel section={current} />;
  else if (current === "payment" && section[1])
    content = <PaymentScreen enrollmentId={section[1]} />;
  else if (current === "test" && section[1])
    content = <TestRunner id={section[1]} />;
  else if (current === "courses" && section[1] === "new" && role === "tutor")
    content = <CourseEditor />;
  else if (current === "courses" && section[1])
    content = <CourseWorkspace id={section[1]} role={role} />;
  else if (current === "courses") content = <MyCourses role={role} />;
  else if (current === "schedule") content = <Schedule />;
  else if (current === "payments") content = <PaymentHistory />;
  else if (current === "results") content = <Results />;
  else if (current === "students") content = <Students />;
  else if (current === "finances") content = <Finances />;
  else if (current === "profile") content = <ProfilePanel />;
  else content = <Empty title="Раздел не найден" />;
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Кабинет">
          {nav[role]!.map(([key, label]) => {
            const Icon = icons[key];
            return (
              <Link
                key={key}
                className={current === key ? "active" : ""}
                href={`/${role}/${key}`}
              >
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <strong>{user.name}</strong>
          <small>{statusLabel[role]}</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <span>Личный кабинет · {statusLabel[role]}</span>
          <div className="actions">
            <Link href="/change-password">Сменить пароль</Link>
            <Link href="/catalog">Каталог ↗</Link>
            <button
              aria-label="Выйти"
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  await result(api.POST("/api/v1/auth/logout"));
                  cache.clear();
                  router.replace("/");
                } catch (e) {
                  setLogoutError(e);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="workspace-body" key={pathname}>
          <ErrorBox error={logoutError} />
          {content}
        </main>
      </div>
    </div>
  );
}
function MyCourses({ role }: { role: "student" | "tutor" }) {
  const [page, setPage] = useState(1);
  const courses = useQuery({
    queryKey: ["my-courses", page],
    queryFn: () =>
      result(
        api.GET("/api/v1/tutors/me/courses", { params: { query: { page } } }),
      ),
    enabled: role === "tutor",
  });
  const enrollments = useQuery({
    queryKey: ["enrollments", page],
    queryFn: () =>
      result(
        api.GET("/api/v1/enrollments/me", { params: { query: { page } } }),
      ),
    enabled: role === "student",
  });
  const state = role === "tutor" ? courses : enrollments;
  return (
    <>
      <div className="row">
        <div>
          <h1>Мои курсы</h1>
          <p className="subheading">
            {role === "tutor"
              ? "Делитесь знаниями. Помогайте расти."
              : "Всё для следующего шага — здесь."}
          </p>
        </div>
        <Button asChild>
          <Link href={role === "tutor" ? "/tutor/courses/new" : "/catalog"}>
            {role === "tutor" ? "+ Создать курс" : "Найти новый курс"}
          </Link>
        </Button>
      </div>
      <ErrorBox error={state.error} />
      {state.isLoading && <Loading />}
      {state.data?.total === 0 && (
        <Empty
          title={
            role === "tutor"
              ? "Создайте свой первый курс"
              : "Ваше обучение начинается здесь"
          }
          text={
            role === "tutor"
              ? "Добавьте описание, материалы и пригласите учеников."
              : "Найдите интересный курс в каталоге и запишитесь на него."
          }
        />
      )}
      <div className="course-grid">
        {courses.data?.items.map((c) => (
          <CourseCard key={c.id} course={c} manage />
        ))}
        {enrollments.data?.items.map((e) => (
          <article key={e.id} className="panel">
            <span className="eyebrow">{e.course.subject}</span>
            <h3>{e.course.title}</h3>
            <Badge status={e.accessStatus} />
            <p className="muted small" style={{ margin: "16px 0" }}>
              Доступ до: {date(e.accessExpiresAt)}
            </p>
            <div className="actions">
              {e.accessStatus === "active" && (
                <Button asChild>
                  <Link href={`/student/courses/${e.courseId}`}>
                    Продолжить
                  </Link>
                </Button>
              )}
              {e.course.status === "published" && (
                <Button variant="outline" asChild>
                  <Link href={`/student/payment/${e.id}`}>
                    {e.accessStatus === "active" ? "Продлить" : "Оплатить"}
                  </Link>
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <Pagination
        page={page}
        total={state.data?.total ?? 0}
        onChange={setPage}
      />
    </>
  );
}
export function Schedule({ courseId }: { courseId?: string }) {
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>();
  const q = useQuery({
    queryKey: ["sessions", courseId, page],
    queryFn: () =>
      courseId
        ? result(
            api.GET("/api/v1/courses/{id}/sessions", {
              params: { path: { id: courseId }, query: { page } },
            }),
          )
        : result(
            api.GET("/api/v1/sessions/me", { params: { query: { page } } }),
          ),
  });
  return (
    <>
      <h1>Расписание</h1>
      <p className="subheading">Время указано для Казахстана (UTC+5).</p>
      <ErrorBox error={q.error || error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && (
        <Empty
          title="Занятий пока нет"
          text="Когда тьютор запланирует встречу, она появится здесь."
        />
      )}
      <div className="panel data-list">
        {q.data?.items.map((s) => (
          <div className="data-row row" key={s.id}>
            <div>
              <span className="eyebrow">{s.course.title}</span>
              <h3>{s.topic}</h3>
              <p className="muted small">
                {date(s.startsAt)} · {s.durationMinutes} мин.
              </p>
            </div>
            <div className="actions">
              <Badge status={s.status} />
              {s.status === "scheduled" && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const popup = window.open("about:blank", "_blank");
                    if (popup) popup.opener = null;
                    try {
                      const { url } = await result(
                        api.GET("/api/v1/sessions/{id}/join", {
                          params: { path: { id: s.id } },
                        }),
                      );
                      if (popup) popup.location.href = url;
                      else window.location.assign(url);
                    } catch (e) {
                      popup?.close();
                      setError(e);
                    }
                  }}
                >
                  Присоединиться ↗
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
function PaymentHistory() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["payments", page],
    queryFn: () =>
      result(api.GET("/api/v1/payments/me", { params: { query: { page } } })),
  });
  const [error, setError] = useState<unknown>();
  return (
    <>
      <h1>История платежей</h1>
      <p className="subheading">Оплаты и результаты проверки.</p>
      <ErrorBox error={q.error || error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty />}
      <div className="panel">
        {q.data?.items.map((p) => (
          <div className="data-row row" key={p.id}>
            <div>
              <strong>{money(p.amountMinor)}</strong>
              <p>{p.enrollment?.course.title}</p>
              <p className="muted small">
                {date(p.createdAt)} · {p.id.slice(0, 8)}
              </p>
              {p.reviewReason && <p className="small">{p.reviewReason}</p>}
            </div>
            <div className="actions">
              <Badge status={p.status} />
              {p.status === "pending" && (
                <Button variant="outline" asChild>
                  <Link href={`/student/payment/${p.enrollmentId}`}>
                    Продолжить оплату
                  </Link>
                </Button>
              )}
              {p.receiptAssetId && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadFile(p.receiptAssetId!).catch(setError)
                  }
                >
                  Чек ↗
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
export function Results({ testId }: { testId?: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["attempts", testId, page],
    queryFn: () =>
      testId
        ? result(
            api.GET("/api/v1/tests/{id}/attempts", {
              params: { path: { id: testId }, query: { page } },
            }),
          )
        : result(
            api.GET("/api/v1/test-attempts/me", {
              params: { query: { page } },
            }),
          ),
  });
  return (
    <>
      <h1>Результаты тестов</h1>
      <p className="subheading">Каждая попытка — шаг вперёд.</p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty title="Попыток пока нет" />}
      <div className="panel">
        {q.data?.items.map((t) => (
          <div className="data-row row" key={t.id}>
            <div>
              <strong>{t.test?.title ?? "Тест"}</strong>
              <p className="small">
                {t.student?.name} · Попытка {t.id.slice(0, 8)}
              </p>
              <p className="muted small">{date(t.submittedAt)}</p>
            </div>
            <div className="actions">
              <Badge status={t.status} />
              <strong>
                {t.score ?? "—"} / {t.maxScore}
              </strong>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
function Students() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["students", page],
    queryFn: () =>
      result(
        api.GET("/api/v1/tutors/me/students", { params: { query: { page } } }),
      ),
  });
  return (
    <>
      <h1>Мои ученики</h1>
      <p className="subheading">Записи на ваши курсы.</p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty />}
      <div className="panel">
        {q.data?.items.map((e) => (
          <div className="data-row row" key={e.id}>
            <div>
              <strong>{e.student.name}</strong>
              <p className="muted small">{e.course.title}</p>
            </div>
            <div>
              <Badge status={e.accessStatus} />
              <p className="muted small">До {date(e.accessExpiresAt)}</p>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
function Finances() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["finances"],
    queryFn: () => result(api.GET("/api/v1/tutors/me/finances")),
  });
  const p = useQuery({
    queryKey: ["payouts", page],
    queryFn: () =>
      result(
        api.GET("/api/v1/tutors/me/payouts", { params: { query: { page } } }),
      ),
  });
  return (
    <>
      <h1>Финансы</h1>
      <p className="subheading">Начисления после комиссии платформы.</p>
      <ErrorBox error={q.error || p.error} />
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="stats">
          {[
            ["Начислено", q.data.accruedMinor],
            ["Ожидает выплаты", q.data.pendingMinor],
            ["Выплачено", q.data.paidMinor],
          ].map(([label, value]) => (
            <div className="stat" key={String(label)}>
              <span>{label}</span>
              <strong>{money(Number(value))}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="panel">
        <h2>История начислений</h2>
        {p.data?.total === 0 && <Empty />}
        {p.data?.items.map((x) => (
          <div className="data-row row" key={x.id}>
            <div>
              <strong>{money(x.netMinor)}</strong>
              <p className="small muted">
                Оплата {money(x.grossMinor)} · комиссия{" "}
                {money(x.commissionMinor)}
              </p>
            </div>
            <Badge status={x.status === "pending" ? "К выплате" : x.status} />
          </div>
        ))}
      </div>
      <Pagination page={page} total={p.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
