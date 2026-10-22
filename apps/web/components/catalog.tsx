"use client";
import { SUBJECTS } from "@tutor/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, result } from "@/lib/api-client";
import {
  CourseCard,
  Empty,
  ErrorBox,
  Footer,
  Header,
  Loading,
  Pagination,
} from "./common";
import { Button } from "./ui/button";
export function Catalog({
  tutors = false,
  initialSubject = "",
  initialTag = "",
  initialSearch = "",
  initialFrom = "",
  initialTo = "",
}: {
  tutors?: boolean;
  initialSubject?: string;
  initialTag?: string;
  initialSearch?: string;
  initialFrom?: string;
  initialTo?: string;
}) {
  const router = useRouter();
  const subjectOptions = useQuery({
    queryKey: ["course-subjects"],
    queryFn: () => result(api.GET("/api/v1/courses/subjects")),
  });
  const subjects = subjectOptions.data?.items ?? [...SUBJECTS];
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: initialSearch,
    tag: initialTag,
    subject: initialSubject,
    from: initialFrom,
    to: initialTo,
  });
  const [query, setQuery] = useState(filters);
  const params = {
    page,
    pageSize: 12,
    ...(query.tag && !tutors ? { tag: query.tag } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.from
      ? { priceFromMinor: Math.round(Number(query.from) * 100) }
      : {}),
    ...(query.to ? { priceToMinor: Math.round(Number(query.to) * 100) } : {}),
  };
  const filterQuery = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v),
  ).toString();
  const courses = useQuery({
    queryKey: ["catalog", params],
    queryFn: () =>
      result(api.GET("/api/v1/courses", { params: { query: params } })),
    enabled: !tutors,
  });
  const teachers = useQuery({
    queryKey: ["tutors", params],
    queryFn: () =>
      result(api.GET("/api/v1/tutors", { params: { query: params } })),
    enabled: tutors,
  });
  const state = tutors ? teachers : courses;
  return (
    <>
      <Header />
      <main className="container">
        <div className="page-heading">
          <span className="eyebrow">НАЙДИТЕ СВОЮ ТОЧКУ РОСТА</span>
          <h1>{tutors ? "Наставники рядом" : "Чему научимся сегодня?"}</h1>
          <p>
            {tutors
              ? "Выберите тьютора, с которым будет комфортно двигаться к цели."
              : "Курсы и наставники для вашего следующего шага."}
          </p>
        </div>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(filters);
            if (!tutors)
              router.push(
                `/catalog?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}`,
              );
          }}
        >
          <label className="field">
            {tutors ? "Имя тьютора" : "Поиск курса"}
            <input
              placeholder={tutors ? "Кого ищем?" : "Название, предмет или #тег"}
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
            />
          </label>
          <label className="field">
            Предмет
            <select
              value={filters.subject}
              onChange={(e) =>
                setFilters({ ...filters, subject: e.target.value })
              }
            >
              <option value="">Все предметы</option>
              {subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Цена от, ₸
            <input
              type="number"
              min="0"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label className="field">
            Цена до, ₸
            <input
              type="number"
              min="0"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
          <Button>Найти</Button>
        </form>
        {query.tag && !tutors && (
          <div className="course-tags">
            <span className="course-tag">#{query.tag}</span>
            <Button
              variant="ghost"
              onClick={() => {
                const next = { ...query, tag: "" };
                setQuery(next);
                setFilters({ ...filters, tag: "" });
                setPage(1);
                router.push(
                  `/catalog?${new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString()}`,
                );
              }}
            >
              Сбросить тег
            </Button>
          </div>
        )}
        <ErrorBox error={state.error} />
        {state.isLoading ? <Loading /> : null}
        {!state.isLoading && state.data?.total === 0 && (
          <Empty
            title="Пока нет совпадений"
            text="Попробуйте другой предмет или измените фильтры."
          />
        )}
        <div className="course-grid">
          {!tutors &&
            courses.data?.items.map((c) => (
              <CourseCard key={c.id} course={c} filterQuery={filterQuery} />
            ))}
          {tutors &&
            teachers.data?.items.map((t) => (
              <article className="panel" key={t.id}>
                <span className="avatar">{t.user.name.slice(0, 1)}</span>
                <h3 style={{ marginTop: 18 }}>{t.user.name}</h3>
                <p className="muted small">{t.subjects.join(" · ")}</p>
                <p style={{ margin: "16px 0" }} className="course-description">
                  {t.bio || "Тьютор готовит информацию о себе."}
                </p>
                <p className="small muted">Опыт: {t.experienceYears} лет</p>
                <Button variant="outline" asChild>
                  <Link href={`/tutors/${t.userId}`}>Познакомиться ↗</Link>
                </Button>
              </article>
            ))}
        </div>
        <Pagination
          page={page}
          total={state.data?.total ?? 0}
          pageSize={12}
          onChange={setPage}
        />
      </main>
      <Footer />
    </>
  );
}
