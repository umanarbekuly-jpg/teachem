"use client";
import { daysLabel } from "@tutor/shared";
import { CourseCover, CourseTags } from "./course-presentation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, result } from "@/lib/api-client";
import { money } from "@/lib/utils";
import { ErrorBox, Footer, Header, Loading } from "./common";
import { Button } from "./ui/button";
export function CourseDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: ["course", id],
    queryFn: () =>
      result(api.GET("/api/v1/courses/{id}", { params: { path: { id } } })),
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => result(api.GET("/api/v1/auth/me")),
    retry: false,
  });
  const enroll = useMutation({
    mutationFn: async () => {
      if (!me.data) {
        router.push("/login");
        return;
      }
      if (me.data.role !== "student")
        throw new Error("Запись доступна из аккаунта ученика");
      const e = await result(
        api.POST("/api/v1/courses/{id}/enrollments", {
          params: { path: { id } },
        }),
      );
      router.push(`/student/payment/${e.id}`);
    },
  });
  const c = query.data;
  return (
    <>
      <Header />
      <main className="container section">
        <Link className="text-link muted" href="/catalog">
          ← Все курсы
        </Link>
        <ErrorBox error={query.error} />
        {query.isLoading && <Loading />}
        {c && (
          <>
            <div className="page-heading">
              <span className="eyebrow">{c.subject}</span>
              <h1>{c.title}</h1>
            </div>
            <div className="detail-layout">
              <section className="panel">
                <CourseCover subject={c.subject} coverUrl={c.coverUrl} />
                <CourseTags tags={c.tags} />
                {me.data?.role === "SUPERADMIN" && (
                  <Link className="text-link" href={`/admin/courses/${c.id}`}>
                    Редактировать курс →
                  </Link>
                )}
                <h2>О курсе</h2>
                <p className="detail-copy">{c.description}</p>
                <hr
                  style={{
                    border: 0,
                    borderTop: "1px solid var(--line)",
                    margin: "28px 0",
                  }}
                />
                <h3>Ваш тьютор</h3>
                <Link className="text-link" href={`/tutors/${c.tutorId}`}>
                  {c.tutor.name} ↗
                </Link>
              </section>
              <aside className="panel detail-aside">
                <span className="eyebrow">
                  {daysLabel(c.durationDays)} обучения
                </span>
                <div className="detail-price">
                  {money(c.monthlyPriceMinor)} / {daysLabel(c.durationDays)}
                </div>
                <p className="muted small" style={{ marginBottom: 20 }}>
                  Материалы, тесты и расписание курса. Доступ откроется после
                  подтверждения оплаты.
                </p>
                <Button
                  onClick={() => enroll.mutate()}
                  disabled={enroll.isPending}
                >
                  Записаться на курс →
                </Button>
                <ErrorBox error={enroll.error} />
                <p className="small muted" style={{ marginTop: 16 }}>
                  Оплата переводом по реквизитам платформы.
                </p>
              </aside>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
export function TutorDetail({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["tutor", id],
    queryFn: () =>
      result(api.GET("/api/v1/tutors/{id}", { params: { path: { id } } })),
  });
  return (
    <>
      <Header />
      <main className="container section">
        <Link href="/tutors">← Все тьюторы</Link>
        <ErrorBox error={q.error} />
        {q.isLoading && <Loading />}
        {q.data && (
          <div className="panel" style={{ marginTop: 28 }}>
            <span className="eyebrow">ВАШ БУДУЩИЙ НАСТАВНИК</span>
            {q.data.photoUrl && (
              <img
                src={q.data.photoUrl}
                alt={q.data.user.name}
                width={96}
                height={96}
                style={{
                  borderRadius: 48,
                  objectFit: "cover",
                  marginBottom: 20,
                }}
              />
            )}
            <h1 style={{ fontSize: 36 }}>{q.data.user.name}</h1>
            <p className="muted" style={{ margin: "12px 0 28px" }}>
              {q.data.subjects.join(" · ")} · Опыт {q.data.experienceYears} лет
            </p>
            <h3>О себе</h3>
            <p className="detail-copy">
              {q.data.bio || "Информация скоро появится."}
            </p>
            <h3 style={{ marginTop: 28 }}>Образование</h3>
            <p>{q.data.education || "Не указано"}</p>
            <h3 style={{ marginTop: 28 }}>Языки</h3>
            <p>{q.data.languages.join(", ") || "Не указаны"}</p>
            <Button asChild style={{ marginTop: 28 }}>
              <Link href="/catalog">Выбрать курс</Link>
            </Button>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
