"use client";
import { UserManagement } from "./user-management";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result, downloadFile, uploadFile } from "@/lib/api-client";
import { Badge, Empty, ErrorBox, Loading, Pagination } from "./common";
import { Button } from "./ui/button";
import { DataForm } from "./forms";
import { date, money, statusLabel } from "@/lib/utils";
export function ProfilePanel() {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["profile"],
    queryFn: () => result(api.GET("/api/v1/tutors/me/profile")),
  });
  const [photo, setPhoto] = useState<File>();
  return (
    <>
      <h2>Профессиональный профиль</h2>
      <p className="subheading">
        Помогите ученикам узнать вас до первого занятия.
      </p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="panel">
          <label className="field" style={{ marginBottom: 20 }}>
            Фото профиля
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0])}
            />
          </label>
          <DataForm
            initial={{
              bio: q.data.bio,
              education: q.data.education,
              experienceYears: q.data.experienceYears,
              subjects: q.data.subjects.join(", "),
              languages: q.data.languages.join(", "),
            }}
            fields={[
              {
                name: "bio",
                label: "О себе",
                type: "textarea",
                required: false,
              },
              {
                name: "education",
                label: "Образование",
                type: "textarea",
                required: false,
              },
              {
                name: "experienceYears",
                label: "Опыт, лет",
                type: "number",
                min: 0,
                max: 80,
              },
              {
                name: "subjects",
                label: "Предметы через запятую",
                help: "Например: Математика, Физика",
              },
              {
                name: "languages",
                label: "Языки через запятую",
                help: "Например: Русский, Казахский",
              },
            ]}
            submit={async (d) => {
              const photoAssetId = photo
                ? await uploadFile(photo, "avatar")
                : undefined;
              await result(
                api.PATCH("/api/v1/tutors/me/profile", {
                  body: {
                    bio: d.bio,
                    education: d.education,
                    experienceYears: Number(d.experienceYears),
                    subjects: d
                      .subjects!.split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    languages: d
                      .languages!.split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    ...(photoAssetId ? { photoAssetId } : {}),
                  },
                }),
              );
              await cache.invalidateQueries({ queryKey: ["profile"] });
            }}
          />
        </div>
      )}
    </>
  );
}
export function AdminPanel({ section }: { section: string }) {
  if (section === "settings") return <Settings />;
  if (section === "users") return <UserManagement />;
  if (section === "payouts") return <Payouts />;
  if (section === "audit") return <Audit />;
  return <Payments />;
}
function Settings() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => result(api.GET("/api/v1/admin/settings")),
  });
  return (
    <>
      <h1>Настройки платформы</h1>
      <p className="subheading">
        Изменение комиссии применяется к новым платежам.
      </p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="panel">
          <DataForm
            initial={{
              commission: q.data.commissionBps / 100,
              paymentDetails: q.data.paymentDetails,
            }}
            fields={[
              {
                name: "commission",
                label: "Комиссия, %",
                type: "number",
                min: 0,
                max: 100,
              },
              {
                name: "paymentDetails",
                label: "Реквизиты для учеников",
                type: "textarea",
                help: "Банк, получатель, номер счёта/телефона и инструкция по назначению перевода.",
              },
            ]}
            submit={(d) =>
              result(
                api.PATCH("/api/v1/admin/settings", {
                  body: {
                    commissionBps: Math.round(Number(d.commission) * 100),
                    paymentDetails: d.paymentDetails!,
                  },
                }),
              )
            }
          />
        </div>
      )}
    </>
  );
}
function Payments() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<
    "awaiting_review" | "approved" | "rejected" | "pending"
  >("awaiting_review");
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<unknown>();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-payments", page, status],
    queryFn: () =>
      result(
        api.GET("/api/v1/admin/payments", {
          params: { query: { page, status } },
        }),
      ),
  });
  const approve = useMutation({
    mutationFn: (id: string) =>
      result(
        api.POST("/api/v1/admin/payments/{id}/approve", {
          params: { path: { id } },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["admin-payments"] }),
  });
  return (
    <>
      <h1>Проверка платежей</h1>
      <p className="subheading">
        Сверьте поступление денег по реквизитам платформы перед подтверждением.
      </p>
      <div className="tabs">
        {(["awaiting_review", "pending", "approved", "rejected"] as const).map(
          (s) => (
            <button
              key={s}
              className={s === status ? "active" : ""}
              onClick={() => {
                setStatus(s);
                setPage(1);
                setSelected(undefined);
              }}
            >
              {statusLabel[s]}
            </button>
          ),
        )}
      </div>
      <ErrorBox error={q.error || approve.error || error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty title="Нет платежей с этим статусом" />}
      <div className="panel">
        {q.data?.items.map((p) => (
          <div className="data-row" key={p.id}>
            <div className="row">
              <div>
                <strong>{money(p.amountMinor)}</strong>
                <p>
                  {p.enrollment?.student.name} · {p.enrollment?.course.title}
                </p>
                <p className="small muted">
                  {date(p.createdAt)} · {p.id.slice(0, 8)}
                </p>
                {p.reviewReason && <p className="small">{p.reviewReason}</p>}
              </div>
              <div className="actions">
                {p.receiptAssetId ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadFile(p.receiptAssetId!).catch(setError)
                    }
                  >
                    Чек ↗
                  </Button>
                ) : (
                  <span className="small muted">Без чека</span>
                )}
                {p.status === "awaiting_review" && (
                  <>
                    <Button
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(p.id)}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        setSelected(selected === p.id ? undefined : p.id)
                      }
                    >
                      Отклонить
                    </Button>
                  </>
                )}
              </div>
            </div>
            {selected === p.id && (
              <div style={{ marginTop: 20 }}>
                <DataForm
                  fields={[
                    {
                      name: "reason",
                      label: "Причина отклонения",
                      type: "textarea",
                    },
                  ]}
                  label="Отклонить платёж"
                  submit={async (d) => {
                    await result(
                      api.POST("/api/v1/admin/payments/{id}/reject", {
                        params: { path: { id: p.id } },
                        body: { reason: d.reason! },
                      }),
                    );
                    setSelected(undefined);
                    await cache.invalidateQueries({
                      queryKey: ["admin-payments"],
                    });
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
function Payouts() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-payouts", page],
    queryFn: () =>
      result(api.GET("/api/v1/admin/payouts", { params: { query: { page } } })),
  });
  return (
    <>
      <h1>Выплаты тьюторам</h1>
      <p className="subheading">
        Сначала выполните перевод, затем сохраните его номер.
      </p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty />}
      <div className="panel">
        {q.data?.items.map((p) => (
          <div className="data-row" key={p.id}>
            <div className="row">
              <div>
                <strong>{money(p.netMinor)}</strong>
                <p className="small muted">
                  Тьютор: {p.tutor?.name ?? p.tutorId} · Комиссия:{" "}
                  {money(p.commissionMinor)}
                </p>
                <p className="small muted">{p.reference}</p>
              </div>
              {p.status === "paid" ? (
                <Badge status="paid" />
              ) : (
                <Button
                  variant="outline"
                  onClick={() =>
                    setSelected(selected === p.id ? undefined : p.id)
                  }
                >
                  Отметить выплату
                </Button>
              )}
            </div>
            {selected === p.id && (
              <div style={{ marginTop: 20 }}>
                <DataForm
                  fields={[
                    {
                      name: "reference",
                      label: "Номер перевода / подтверждение",
                    },
                  ]}
                  label="Подтвердить выплату"
                  submit={async (d) => {
                    await result(
                      api.POST("/api/v1/admin/payouts/{id}/mark-paid", {
                        params: { path: { id: p.id } },
                        body: { reference: d.reference! },
                      }),
                    );
                    setSelected(undefined);
                    await cache.invalidateQueries({
                      queryKey: ["admin-payouts"],
                    });
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit", page],
    queryFn: () =>
      result(
        api.GET("/api/v1/admin/audit-logs", { params: { query: { page } } }),
      ),
  });
  const actions: Record<string, string> = {
    "payment.approved": "Платёж подтверждён",
    "payment.rejected": "Платёж отклонён",
    "user.block": "Пользователь заблокирован",
    "user.unblock": "Пользователь разблокирован",
    "settings.update": "Настройки изменены",
    "payout.paid": "Выплата отмечена",
  };
  return (
    <>
      <h1>Журнал действий</h1>
      <p className="subheading">История административных изменений.</p>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data?.total === 0 && <Empty />}
      <div className="panel">
        {q.data?.items.map((e) => (
          <div className="data-row" key={e.id}>
            <strong>{actions[e.action] ?? e.action}</strong>
            <p className="small muted">
              {date(e.createdAt)} · {e.entityId}
            </p>
            <p className="small muted">Администратор: {e.actorId}</p>
          </div>
        ))}
      </div>
      <Pagination page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
