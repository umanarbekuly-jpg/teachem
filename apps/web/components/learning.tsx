"use client";
import { useState } from "react";
import Link from "next/link";
import { daysLabel } from "@tutor/shared";
import { CourseEditor } from "./course-editor";
export { CourseEditor } from "./course-editor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result, downloadFile, uploadFile } from "@/lib/api-client";
import { Badge, Empty, ErrorBox, Loading, Pagination } from "./common";
import { Button } from "./ui/button";
import { DataForm } from "./forms";
import { Schedule, Results } from "./dashboard";
import { TestEditor } from "./tests";
import { date, money } from "@/lib/utils";
import type { components } from "@/lib/api-client/schema";
type Course = components["schemas"]["CourseView"];
export function CourseWorkspace({
  id,
  role,
}: {
  id: string;
  role: "student" | "tutor";
}) {
  const [tab, setTab] = useState("materials");
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const course = useQuery({
    queryKey: ["workspace-course", id, role],
    queryFn: () =>
      result(
        api.GET("/api/v1/learning/courses/{id}", { params: { path: { id } } }),
      ),
  });
  const c = course.data;
  return (
    <>
      <Link className="small muted" href={`/${role}/courses`}>
        ← Мои курсы
      </Link>
      <div className="row" style={{ marginTop: 16 }}>
        <div>
          <h1>{c?.title ?? "Учебное пространство"}</h1>
          <p className="muted">{c?.subject}</p>
        </div>
        {role === "tutor" && c && (
          <div className="actions">
            <Badge status={c.status} />
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (c.status === "published")
                    await result(
                      api.POST("/api/v1/courses/{id}/archive", {
                        params: { path: { id } },
                      }),
                    );
                  else
                    await result(
                      api.POST("/api/v1/courses/{id}/publish", {
                        params: { path: { id } },
                      }),
                    );
                  await cache.invalidateQueries({
                    queryKey: ["workspace-course"],
                  });
                } catch (e) {
                  setActionError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {c.status === "published" ? "В архив" : "Опубликовать"}
            </Button>
          </div>
        )}
      </div>
      <ErrorBox error={course.error || actionError} />
      <div className="tabs">
        {[
          ["materials", "Материалы"],
          ["tests", "Тесты"],
          ["sessions", "Занятия"],
          ...(role === "tutor" ? [["edit", "О курсе"]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key!)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "materials" && (
        <Materials courseId={id} tutor={role === "tutor"} />
      )}{" "}
      {tab === "tests" && <TestsPanel courseId={id} tutor={role === "tutor"} />}{" "}
      {tab === "sessions" && (
        <>
          <Schedule courseId={id} />
          {role === "tutor" && <SessionEditor courseId={id} />}
        </>
      )}
      {tab === "edit" && c && <CourseEditor course={c as Course} />}
    </>
  );
}
function Materials({ courseId, tutor }: { courseId: string; tutor: boolean }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<unknown>();
  const q = useQuery({
    queryKey: ["materials", courseId, page],
    queryFn: () =>
      result(
        api.GET("/api/v1/courses/{id}/materials", {
          params: { path: { id: courseId }, query: { page } },
        }),
      ),
  });
  return (
    <>
      <ErrorBox error={q.error || error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && (
        <Empty
          title="Материалы появятся здесь"
          text="Файлы, полезные ссылки и всё для самостоятельной работы."
        />
      )}
      <div className="panel">
        {q.data?.items.map((m) => (
          <div className="data-row row" key={m.id}>
            <div>
              <h3>{m.title}</h3>
              <span className="small muted">
                {m.kind === "file" ? "Учебный файл" : "Полезная ссылка"}
              </span>
            </div>
            <div className="actions">
              {m.kind === "file" ? (
                <Button
                  variant="outline"
                  onClick={() => downloadFile(m.fileAssetId!).catch(setError)}
                >
                  Скачать ↓
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <a href={m.url!} target="_blank" rel="noopener noreferrer">
                    Открыть ↗
                  </a>
                </Button>
              )}
              {tutor && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await result(
                        api.DELETE("/api/v1/materials/{id}", {
                          params: { path: { id: m.id } },
                        }),
                      );
                      await cache.invalidateQueries({
                        queryKey: ["materials"],
                      });
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  Удалить
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
      {tutor && (
        <section className="panel">
          <h2>Добавить материал</h2>
          <div className="role-selector" style={{ marginBottom: 20 }}>
            <button
              className={kind === "file" ? "selected" : ""}
              onClick={() => setKind("file")}
            >
              Файл
            </button>
            <button
              className={kind === "link" ? "selected" : ""}
              onClick={() => setKind("link")}
            >
              Ссылка
            </button>
          </div>
          {kind === "file" && (
            <label className="field" style={{ marginBottom: 20 }}>
              Файл до 20 МиБ
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
          )}
          <DataForm
            key={kind}
            fields={[
              { name: "title", label: "Название" },
              ...(kind === "link"
                ? [{ name: "url", label: "Ссылка HTTPS", type: "url" as const }]
                : []),
            ]}
            label="Добавить материал"
            submit={async (d) => {
              let fileAssetId: string | undefined;
              if (kind === "file") {
                if (!file) throw new Error("Выберите файл");
                fileAssetId = await uploadFile(file, "material");
              }
              await result(
                api.POST("/api/v1/courses/{id}/materials", {
                  params: { path: { id: courseId } },
                  body: {
                    title: d.title!,
                    kind,
                    ...(fileAssetId ? { fileAssetId } : { url: d.url }),
                  },
                }),
              );
              await cache.invalidateQueries({ queryKey: ["materials"] });
            }}
          />
        </section>
      )}
    </>
  );
}
function TestsPanel({ courseId, tutor }: { courseId: string; tutor: boolean }) {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [results, setResults] = useState<string>();
  const [error, setError] = useState<unknown>();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["tests", courseId, page],
    queryFn: () =>
      result(
        api.GET("/api/v1/courses/{id}/tests", {
          params: { path: { id: courseId }, query: { page } },
        }),
      ),
  });
  return (
    <>
      <div className="row">
        <h2>Тесты курса</h2>
        {tutor && (
          <Button
            onClick={() => {
              setEditing(undefined);
              setCreating(!creating);
            }}
          >
            {creating ? "Закрыть редактор" : "+ Новый тест"}
          </Button>
        )}
      </div>
      <ErrorBox error={q.error || error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty title="Тестов пока нет" />}
      <div className="panel" style={{ marginTop: 20 }}>
        {q.data?.items.map((t) => (
          <div className="data-row row" key={t.id}>
            <h3>{t.title}</h3>
            <div className="actions">
              <Badge status={t.status} />
              {!tutor ? (
                <Button asChild>
                  <Link href={`/student/test/${t.id}`}>Пройти тест</Link>
                </Button>
              ) : (
                <>
                  {t.status === "draft" && (
                    <Button
                      onClick={async () => {
                        try {
                          await result(
                            api.POST("/api/v1/tests/{id}/publish", {
                              params: { path: { id: t.id } },
                            }),
                          );
                          await cache.invalidateQueries({
                            queryKey: ["tests"],
                          });
                        } catch (e) {
                          setError(e);
                        }
                      }}
                    >
                      Опубликовать
                    </Button>
                  )}
                  {t.status === "draft" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing(t.id);
                        setCreating(true);
                      }}
                    >
                      Редактировать
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      setResults(results === t.id ? undefined : t.id)
                    }
                  >
                    Результаты
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await result(
                          api.POST("/api/v1/tests/{id}/copy", {
                            params: { path: { id: t.id } },
                          }),
                        );
                        await cache.invalidateQueries({ queryKey: ["tests"] });
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Копия
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
      {creating && (
        <TestEditor
          key={editing ?? "new"}
          courseId={courseId}
          testId={editing}
          onDone={() => {
            setCreating(false);
            setEditing(undefined);
            cache.invalidateQueries({ queryKey: ["tests"] });
          }}
        />
      )}
      {results && <Results testId={results} />}
    </>
  );
}
function SessionEditor({ courseId }: { courseId: string }) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["sessions-manage", courseId],
    queryFn: () =>
      result(
        api.GET("/api/v1/courses/{id}/sessions", {
          params: { path: { id: courseId }, query: { pageSize: 100 } },
        }),
      ),
  });
  const [error, setError] = useState<unknown>();
  return (
    <div className="panel">
      <h2>Запланировать занятие</h2>
      <DataForm
        fields={[
          { name: "topic", label: "Тема" },
          {
            name: "startsAt",
            label: "Дата и время (часовой пояс вашего устройства)",
            type: "datetime-local",
          },
          {
            name: "durationMinutes",
            label: "Продолжительность, минут",
            type: "number",
            min: 5,
            max: 480,
          },
          { name: "joinUrl", label: "Ссылка Google Meet", type: "url" },
        ]}
        initial={{ durationMinutes: 60 }}
        label="Создать занятие"
        submit={async (d) => {
          await result(
            api.POST("/api/v1/courses/{id}/sessions", {
              params: { path: { id: courseId } },
              body: {
                topic: d.topic!,
                startsAt: new Date(d.startsAt!).toISOString(),
                durationMinutes: Number(d.durationMinutes),
                joinUrl: d.joinUrl!,
              },
            }),
          );
          await cache.invalidateQueries({ queryKey: ["sessions"] });
          await cache.invalidateQueries({ queryKey: ["sessions-manage"] });
        }}
      />
      <ErrorBox error={error} />
      {q.data?.items
        .filter((s) => s.status === "scheduled")
        .map((s) => (
          <div className="data-row row" key={s.id}>
            <span>
              {s.topic} · {date(s.startsAt)}
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await result(
                    api.POST("/api/v1/sessions/{id}/cancel", {
                      params: { path: { id: s.id } },
                    }),
                  );
                  await cache.invalidateQueries({ queryKey: ["sessions"] });
                  await cache.invalidateQueries({
                    queryKey: ["sessions-manage"],
                  });
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Отменить занятие
            </Button>
          </div>
        ))}
    </div>
  );
}
export function PaymentScreen({ enrollmentId }: { enrollmentId: string }) {
  const cache = useQueryClient();
  const [file, setFile] = useState<File>();
  const [paymentId, setPaymentId] = useState<string>();
  const create = useMutation({
    mutationFn: () =>
      result(
        api.POST("/api/v1/enrollments/{id}/payments", {
          params: { path: { id: enrollmentId } },
          body: { idempotencyKey: crypto.randomUUID() },
        }),
      ),
    onSuccess: (p) => setPaymentId(p.id),
  });
  const details = useQuery({
    queryKey: ["payment-details", paymentId],
    enabled: !!paymentId,
    queryFn: () =>
      result(
        api.GET("/api/v1/payments/{id}/instructions", {
          params: { path: { id: paymentId! } },
        }),
      ),
  });
  const payment = useQuery({
    queryKey: ["payment", paymentId],
    enabled: !!paymentId,
    queryFn: () =>
      result(
        api.GET("/api/v1/payments/{id}", {
          params: { path: { id: paymentId! } },
        }),
      ),
  });
  const submit = useMutation({
    mutationFn: async () => {
      const receiptAssetId = file
        ? await uploadFile(file, "receipt")
        : undefined;
      return result(
        api.POST("/api/v1/payments/{id}/submit", {
          params: { path: { id: paymentId! } },
          body: { receiptAssetId },
        }),
      );
    },
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ["payment"] });
      cache.invalidateQueries({ queryKey: ["payments"] });
    },
  });
  return (
    <>
      <h1>Оплата курса</h1>
      <p className="subheading">
        {payment.data
          ? `Доступ на ${daysLabel(payment.data.durationDays)} после подтверждения платежа.`
          : "Срок и сумма будут зафиксированы при получении реквизитов."}
      </p>
      <div className="panel">
        <h2>Как это работает</h2>
        <p className="muted pre-wrap">
          1. Получите реквизиты и сумму платежа.{"\n"}2. Выполните перевод в
          банковском приложении.{"\n"}3. Нажмите «Я оплатил». Чек можно
          приложить по желанию.{"\n"}4. После проверки администратором доступ
          откроется автоматически.
        </p>
        {!paymentId && (
          <Button
            style={{ marginTop: 24 }}
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            Получить реквизиты
          </Button>
        )}
        <ErrorBox
          error={create.error || details.error || payment.error || submit.error}
        />
        {details.data && (
          <div className="question">
            <span className="eyebrow">СУММА К ПЕРЕВОДУ</span>
            <h2>{money(details.data.amountMinor)}</h2>
            <p className="pre-wrap">{details.data.details}</p>
            <p className="small muted" style={{ marginTop: 16 }}>
              Назначение перевода: {details.data.reference}
            </p>
          </div>
        )}
        {payment.data && <Badge status={payment.data.status} />}{" "}
        {payment.data?.status === "pending" && (
          <div className="form-stack" style={{ marginTop: 20 }}>
            <label className="field">
              Чек (необязательно)
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <div>
              <Button
                disabled={submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? "Отправляем…" : "Я оплатил"}
              </Button>
            </div>
          </div>
        )}
        {payment.data?.status === "awaiting_review" && (
          <div className="success">
            Платёж передан на проверку. Результат появится в истории платежей.
          </div>
        )}
      </div>
      <Button variant="outline" asChild>
        <Link href="/student/payments">История платежей</Link>
      </Button>
    </>
  );
}
