"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SUBJECTS,
  COVER_MAX_BYTES,
  normalizeSubject,
  normalizeTag,
  TAG_PATTERN,
} from "@tutor/shared";
import { api, result, uploadFile } from "@/lib/api-client";
import {
  Course,
  CourseCard,
  ErrorBox,
  Loading,
  Pagination,
  Empty,
} from "./common";
import { Button } from "./ui/button";
import { CourseCover } from "./course-presentation";

export function AdminCourses() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["admin-courses", page],
    queryFn: () =>
      result(api.GET("/api/v1/admin/courses", { params: { query: { page } } })),
  });
  return (
    <>
      <h1>Курсы</h1>
      <p className="subheading">
        Редактирование курсов и обложек, включая черновики и архив.
      </p>
      <ErrorBox error={query.error} />
      {query.isLoading && <Loading />}
      {query.data?.total === 0 && <Empty />}
      <div className="course-grid">
        {query.data?.items.map((c) => (
          <CourseCard key={c.id} course={c} manage managePrefix="admin" />
        ))}
      </div>
      <Pagination
        page={page}
        total={query.data?.total ?? 0}
        onChange={setPage}
      />
    </>
  );
}

export function ManagedCourseEditor({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["edit-course", id],
    queryFn: () =>
      result(
        api.GET("/api/v1/courses/{id}/edit", { params: { path: { id } } }),
      ),
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isLoading && <Loading />}
      {query.data && <CourseEditor key={id} course={query.data} />}
    </>
  );
}

export function CourseEditor({ course }: { course?: Course }) {
  const router = useRouter(),
    cache = useQueryClient();
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [subject, setSubject] = useState<string>(
    course?.subject ?? SUBJECTS[0],
  );
  const [custom, setCustom] = useState(
    !!course && !SUBJECTS.some((s) => s === course.subject),
  );
  const [duration, setDuration] = useState(String(course?.durationDays ?? 30));
  const [price, setPrice] = useState(
    course ? String(course.monthlyPriceMinor / 100) : "",
  );
  const [tags, setTags] = useState<string[]>(course?.tags ?? []);
  const [tag, setTag] = useState("");
  const [tagError, setTagError] = useState("");
  const [coverId, setCoverId] = useState<string | null>(
    course?.coverAssetId ?? null,
  );
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState(course?.coverUrl ?? null);
  const [coverError, setCoverError] = useState("");
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function addTag() {
    const next = normalizeTag(tag);
    const message =
      tags.length >= 3
        ? "Можно добавить только 3 тега"
        : !TAG_PATTERN.test(next)
          ? "От 1 до 30 букв, цифр или символов _. Пробелы внутри тега не допускаются."
          : tags.includes(next)
            ? "Этот тег уже добавлен"
            : "";
    setTagError(message);
    if (message) return false;
    setTags([...tags, next]);
    setTag("");
    return true;
  }
  return (
    <>
      <h1>{course ? "Редактировать курс" : "Новый курс"}</h1>
      <p className="subheading">
        Расскажите, чему научится ученик и как проходят занятия.
      </p>
      <form
        className="panel form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(undefined);
          setSaved(false);
          if (tag.trim()) {
            setTagError(
              "Добавьте введённый тег кнопкой «Добавить» или очистите поле.",
            );
            return;
          }
          if (coverError) return;
          setBusy(true);
          try {
            const asset = file
              ? await uploadFile(file, "course_cover")
              : coverId;
            const body = {
              title: title.trim(),
              description: description.trim(),
              subject: normalizeSubject(subject),
              durationDays: Number(duration),
              monthlyPriceMinor: Math.round(Number(price) * 100),
              tags,
              coverAssetId: asset,
            };
            const changed = course
              ? await result(
                  api.PATCH("/api/v1/courses/{id}", {
                    params: { path: { id: course.id } },
                    body,
                  }),
                )
              : await result(api.POST("/api/v1/courses", { body }));
            setCoverId(changed.coverAssetId);
            setFile(undefined);
            setPreview(changed.coverUrl);
            setSubject(changed.subject);
            setSaved(true);
            for (const key of [
              "my-courses",
              "workspace-course",
              "catalog",
              "course",
              "edit-course",
              "course-subjects",
              "admin-courses",
            ])
              await cache.invalidateQueries({ queryKey: [key] });
            if (!course) router.push(`/tutor/courses/${changed.id}`);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="course-fields form-stack">
          <label className="field">
            Название курса
            <input
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Описание
            <textarea
              required
              minLength={20}
              maxLength={10000}
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field">
            <label htmlFor="course-cover">Обложка курса</label>
            <div className="cover-preview">
              <CourseCover subject={subject} coverUrl={preview} />
            </div>
            <input
              id="course-cover"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (
                  f.size > COVER_MAX_BYTES ||
                  !["image/jpeg", "image/png", "image/webp"].includes(f.type)
                ) {
                  setCoverError("Выберите JPEG, PNG или WebP до 5 МБ");
                  e.target.value = "";
                  return;
                }
                setCoverError("");
                setFile(f);
                e.target.value = "";
              }}
            />
            <span className="small muted">
              JPEG, PNG или WebP до 5 МБ. Без файла используется обложка
              предмета.
            </span>
            {coverError && (
              <span role="alert" className="field-error">
                {coverError}
              </span>
            )}
            {(preview || coverId || coverError) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFile(undefined);
                  setCoverId(null);
                  setPreview(null);
                  setCoverError("");
                }}
              >
                Убрать обложку
              </Button>
            )}
          </div>
          <label className="field">
            Предмет
            <select
              value={custom ? "__custom" : subject}
              onChange={(e) => {
                const own = e.target.value === "__custom";
                setCustom(own);
                setSubject(own ? "" : e.target.value);
              }}
            >
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
              <option value="__custom">Добавить свой предмет</option>
            </select>
          </label>
          {custom && (
            <label className="field">
              Свой предмет
              <input
                required
                maxLength={80}
                value={subject}
                placeholder="Например, Вайбкодинг"
                onChange={(e) => setSubject(e.target.value)}
                onBlur={() => setSubject(normalizeSubject(subject))}
              />
            </label>
          )}
          <label className="field">
            Длительность, дней
            <input
              type="number"
              required
              min={1}
              max={2147483647}
              step={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <div className="course-presets">
            {[
              [7, "7 дней"],
              [30, "Месяц — 30 дней"],
              [180, "Полгода — 180 дней"],
            ].map(([days, label]) => (
              <Button
                key={days}
                type="button"
                variant="outline"
                aria-pressed={duration === String(days)}
                onClick={() => setDuration(String(days))}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="field">
            Цена за выбранный срок, ₸
            <input
              type="number"
              required
              min={1}
              max={10000000}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <p className="small muted">
            Общая цена за весь срок. Новые условия действуют только для новых
            покупок.
          </p>
          <div className="field">
            <label htmlFor="course-tags">Хештеги</label>
            <span className="small muted">
              До 3 тегов, чтобы ученикам было проще найти курс
            </span>
            <div className="course-tags">
              {tags.map((t) => (
                <span className="course-tag" key={t}>
                  #{t}
                  <button
                    type="button"
                    aria-label={`Удалить тег ${t}`}
                    onClick={() => {
                      setTags(tags.filter((v) => v !== t));
                      setTagError("");
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="tag-entry">
              <input
                id="course-tags"
                value={tag}
                disabled={tags.length === 3}
                placeholder="#подготовка"
                aria-describedby="tag-help"
                onChange={(e) => {
                  setTag(e.target.value);
                  setTagError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={tags.length === 3}
                onClick={addTag}
              >
                Добавить
              </Button>
            </div>
            <span id="tag-help" className="small muted">
              {tags.length} из 3
            </span>
            {tagError && (
              <span role="alert" className="field-error">
                {tagError}
              </span>
            )}
          </div>
          <ErrorBox error={error} />
          {saved && (
            <p role="status" className="success">
              Изменения сохранены
            </p>
          )}
          <Button type="submit">
            {busy ? "Сохраняем…" : "Сохранить курс"}
          </Button>
        </fieldset>
      </form>
    </>
  );
}
