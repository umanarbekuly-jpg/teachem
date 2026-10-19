"use client";
import Link from "next/link";
import { BRAND } from "@tutor/shared";
import { Logo } from "./brand/logo";
export { Logo } from "./brand/logo";
import {
  ArrowUpRight,
  BookOpen,
  LoaderCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, result } from "@/lib/api-client";
import { Button } from "./ui/button";
import { money, statusLabel } from "@/lib/utils";
import type { components } from "@/lib/api-client/schema";
export type Course = components["schemas"]["CourseView"];
export function Header() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => result(api.GET("/api/v1/auth/me")),
    retry: false,
  });
  return (
    <header className="header">
      <div className="container header-inner">
        <Logo />
        <nav aria-label="Основная навигация">
          <Link href="/catalog">Курсы</Link>
          <Link href="/tutors">Тьюторы</Link>
        </nav>
        <Button variant="outline" asChild>
          <Link href={me.data ? `/${me.data.role}` : "/login"}>
            {me.data ? "Мой кабинет" : "Войти"}
            <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer container">
      <Logo />
      <p>{BRAND.tagline}</p>
      <span>Платформа для учеников и тьюторов</span>
    </footer>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error-box">
      {error instanceof Error ? error.message : "Что-то пошло не так"}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="empty">
      <LoaderCircle className="spin" />
      Загружаем…
    </div>
  );
}
export function Empty({
  title = "Здесь пока ничего нет",
  text = "Новые записи появятся в этом разделе.",
  children,
}: {
  title?: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      {statusLabel[status] ?? status}
    </span>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  return total > pageSize ? (
    <div className="pagination">
      <Button
        variant="outline"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        Назад
      </Button>
      <span>
        {page} / {Math.ceil(total / pageSize)}
      </span>
      <Button
        variant="outline"
        disabled={page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        Далее
      </Button>
    </div>
  ) : null;
}
export function CourseCard({
  course,
  manage = false,
}: {
  course: Course;
  manage?: boolean;
}) {
  const icons: Record<string, string> = {
    Математика: "∑",
    Физика: "↗",
    "Английский язык": "Aa",
    Информатика: "</>",
    Химия: "H₂O",
  };
  return (
    <article className="course-card">
      <div className={`course-art art-${course.subject.length % 4}`}>
        <span className="art-symbol">{icons[course.subject] ?? "✳"}</span>
        <span className="art-tag">{course.subject}</span>
        <div className="art-orbit" />
      </div>
      <div className="course-body">
        <div className="eyebrow">
          {course.level}
          {manage && <Badge status={course.status} />}
        </div>
        <Link
          className="course-title"
          href={
            manage ? `/tutor/courses/${course.id}` : `/courses/${course.id}`
          }
        >
          {course.title}
        </Link>
        <p className="course-description">{course.description}</p>
        <div className="tutor-mini">
          <span className="avatar">
            {course.tutor?.name?.slice(0, 1) ?? "Т"}
          </span>
          {course.tutor?.name ?? "Ваш курс"}
        </div>
        <div className="course-price">
          <div>
            <strong>{money(course.monthlyPriceMinor)}</strong>
            <span> / 30 дней</span>
          </div>
          <Link
            aria-label={`Открыть ${course.title}`}
            href={
              manage ? `/tutor/courses/${course.id}` : `/courses/${course.id}`
            }
          >
            <ArrowUpRight size={20} />
          </Link>
        </div>
      </div>
    </article>
  );
}
