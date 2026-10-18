"use client";
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, result } from "@/lib/api-client";
import { ErrorBox, Loading } from "./common";
import { Button } from "./ui/button";
const question = z.object({
  text: z.string().min(1),
  type: z.enum(["single", "multiple"]),
  points: z.number().int().min(1).max(1000),
  options: z
    .array(z.object({ text: z.string().min(1), isCorrect: z.boolean() }))
    .min(2)
    .max(10),
});
const schema = z.object({
  title: z.string().min(2),
  questions: z.array(question).min(1).max(50),
});
type TestValues = z.infer<typeof schema>;
const emptyQuestion = () => ({
  text: "",
  type: "single" as const,
  points: 1,
  options: [
    { text: "", isCorrect: true },
    { text: "", isCorrect: false },
  ],
});
function TestEditorForm({
  courseId,
  testId,
  onDone,
  initial,
}: {
  courseId: string;
  testId?: string;
  onDone: () => void;
  initial?: TestValues;
}) {
  const [error, setError] = useState<unknown>();
  const form = useForm<TestValues>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { title: "", questions: [emptyQuestion()] },
  });
  const questions = useFieldArray({ control: form.control, name: "questions" });
  const values = form.watch();
  return (
    <section className="panel">
      <h2>Конструктор теста</h2>
      <p className="muted small">
        После публикации тест нельзя изменить. Для новой версии создайте копию.
      </p>
      <form
        className="form-stack"
        onSubmit={form.handleSubmit(async (data) => {
          try {
            for (const q of data.questions) {
              const n = q.options.filter((o) => o.isCorrect).length;
              if (!n || (q.type === "single" && n !== 1))
                throw new Error(
                  "Проверьте правильные ответы: один для одиночного выбора, минимум один для множественного.",
                );
            }
            if (testId)
              await result(
                api.PATCH("/api/v1/tests/{id}", {
                  params: { path: { id: testId } },
                  body: data,
                }),
              );
            else
              await result(
                api.POST("/api/v1/courses/{id}/tests", {
                  params: { path: { id: courseId } },
                  body: data,
                }),
              );
            onDone();
          } catch (e) {
            setError(e);
          }
        })}
      >
        <label className="field">
          Название
          <input {...form.register("title")} />
        </label>
        {questions.fields.map((q, i) => (
          <div className="question" key={q.id}>
            <div className="row">
              <h3>Вопрос {i + 1}</h3>
              <Button
                type="button"
                variant="ghost"
                disabled={questions.fields.length === 1}
                onClick={() => questions.remove(i)}
              >
                Удалить
              </Button>
            </div>
            <label className="field">
              Вопрос
              <textarea {...form.register(`questions.${i}.text`)} />
            </label>
            <div className="grid-two" style={{ margin: "14px 0" }}>
              <label className="field">
                Выбор
                <select {...form.register(`questions.${i}.type`)}>
                  <option value="single">Один ответ</option>
                  <option value="multiple">Несколько ответов</option>
                </select>
              </label>
              <label className="field">
                Баллы
                <input
                  type="number"
                  min="1"
                  max="1000"
                  {...form.register(`questions.${i}.points`, {
                    valueAsNumber: true,
                  })}
                />
              </label>
            </div>
            <p className="small muted">Отметьте правильные варианты.</p>
            {values.questions[i]?.options.map((_o, j) => (
              <div className="answer-option" key={j}>
                <input
                  aria-label={`Правильный ответ ${j + 1}`}
                  type="checkbox"
                  {...form.register(`questions.${i}.options.${j}.isCorrect`)}
                />
                <input
                  className="input"
                  placeholder={`Вариант ${j + 1}`}
                  {...form.register(`questions.${i}.options.${j}.text`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={values.questions[i]!.options.length <= 2}
                  onClick={() =>
                    form.setValue(
                      `questions.${i}.options`,
                      values.questions[i]!.options.filter((_, n) => n !== j),
                    )
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={values.questions[i]!.options.length >= 10}
              onClick={() =>
                form.setValue(`questions.${i}.options`, [
                  ...values.questions[i]!.options,
                  { text: "", isCorrect: false },
                ])
              }
            >
              + Вариант ответа
            </Button>
          </div>
        ))}
        <div className="actions">
          <Button
            type="button"
            variant="outline"
            disabled={questions.fields.length >= 50}
            onClick={() => questions.append(emptyQuestion())}
          >
            + Вопрос
          </Button>
          <Button disabled={form.formState.isSubmitting}>
            Сохранить черновик
          </Button>
        </div>
        {Object.keys(form.formState.errors).length > 0 && (
          <div className="error-box">
            Заполните название, вопросы и все варианты ответов.
          </div>
        )}
        <ErrorBox error={error} />
      </form>
    </section>
  );
}
export function TestRunner({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["test", id],
    queryFn: () =>
      result(api.GET("/api/v1/tests/{id}", { params: { path: { id } } })),
  });
  const [attemptId, setAttemptId] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const start = useMutation({
    mutationFn: () =>
      result(
        api.POST("/api/v1/tests/{id}/attempts", { params: { path: { id } } }),
      ),
    onSuccess: (a) => setAttemptId(a.id),
  });
  const submit = useMutation({
    mutationFn: async () => {
      await result(
        api.PUT("/api/v1/test-attempts/{id}/answers", {
          params: { path: { id: attemptId! } },
          body: {
            answers: Object.entries(answers).map(([questionId, optionIds]) => ({
              questionId,
              optionIds,
            })),
          },
        }),
      );
      return result(
        api.POST("/api/v1/test-attempts/{id}/submit", {
          params: { path: { id: attemptId! } },
        }),
      );
    },
  });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <h1>{q.data?.title ?? "Тест"}</h1>
      <p className="subheading">
        За вопрос начисляются баллы при выборе всех правильных вариантов без
        лишних.
      </p>
      <ErrorBox error={q.error || start.error || submit.error} />
      {submit.data ? (
        <section className="panel">
          <span className="eyebrow">ТЕСТ ЗАВЕРШЁН</span>
          <h2 style={{ fontSize: 42 }}>
            {submit.data.score} / {submit.data.maxScore}
          </h2>
          <p>Ваш результат сохранён. Продолжайте практиковаться!</p>
          <Button
            style={{ marginTop: 20 }}
            onClick={() => {
              setAttemptId(undefined);
              setAnswers({});
              submit.reset();
            }}
          >
            Попробовать ещё раз
          </Button>
        </section>
      ) : !attemptId ? (
        <Button
          disabled={start.isPending || !q.data}
          onClick={() => start.mutate()}
        >
          Начать тест
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          {q.data?.questions.map((question, i) => (
            <section className="panel" key={question.id}>
              <span className="eyebrow">
                ВОПРОС {i + 1} · {question.points} БАЛЛ.
              </span>
              <h3>{question.text}</h3>
              <p className="muted small">
                {question.type === "single"
                  ? "Выберите один ответ"
                  : "Выберите все подходящие ответы"}
              </p>
              {question.options.map((o) => (
                <label className="answer-option" key={o.id}>
                  <input
                    type={question.type === "single" ? "radio" : "checkbox"}
                    name={question.id}
                    checked={answers[question.id]?.includes(o.id) ?? false}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]:
                          question.type === "single"
                            ? [o.id]
                            : e.target.checked
                              ? [...(prev[question.id] ?? []), o.id]
                              : (prev[question.id] ?? []).filter(
                                  (x) => x !== o.id,
                                ),
                      }))
                    }
                  />
                  {o.text}
                </label>
              ))}
            </section>
          ))}
          <Button disabled={submit.isPending}>Завершить тест</Button>
        </form>
      )}
    </>
  );
}

export function TestEditor({
  courseId,
  testId,
  onDone,
}: {
  courseId: string;
  testId?: string;
  onDone: () => void;
}) {
  const q = useQuery({
    queryKey: ["test-edit", testId],
    enabled: !!testId,
    queryFn: () =>
      result(
        api.GET("/api/v1/tests/{id}", { params: { path: { id: testId! } } }),
      ),
  });
  if (testId && q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const initial = q.data
    ? {
        title: q.data.title,
        questions: q.data.questions.map((q) => ({
          text: q.text,
          type: q.type,
          points: q.points,
          options: q.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect ?? false,
          })),
        })),
      }
    : undefined;
  return (
    <TestEditorForm
      courseId={courseId}
      testId={testId}
      onDone={onDone}
      initial={initial}
    />
  );
}
