"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "./ui/button";
import { ErrorBox } from "./common";
export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "datetime-local" | "url";
  required?: boolean;
  options?: string[];
  help?: string;
  min?: number;
  max?: number;
};
export function DataForm({
  fields,
  initial = {},
  submit,
  label = "Сохранить",
  onDone,
}: {
  fields: Field[];
  initial?: Record<string, string | number>;
  submit: (data: Record<string, string>) => Promise<unknown>;
  label?: string;
  onDone?: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const shape = Object.fromEntries(
    fields.map((f) => {
      let rule = z.string();
      if (f.required !== false) rule = rule.min(1, "Заполните поле");
      return [f.name, rule];
    }),
  );
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(z.object(shape)),
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, String(initial[f.name] ?? "")]),
    ),
  });
  return (
    <form
      className="form-stack"
      onSubmit={form.handleSubmit(async (data) => {
        setError(undefined);
        setSuccess(false);
        try {
          await submit(data);
          setSuccess(true);
          onDone?.();
        } catch (e) {
          setError(e);
        }
      })}
    >
      {fields.map((f) => (
        <label className="field" key={f.name}>
          {f.label}
          {f.options ? (
            <select {...form.register(f.name)}>
              <option value="">Выберите…</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea {...form.register(f.name)} />
          ) : (
            <input
              type={f.type ?? "text"}
              min={f.min}
              max={f.max}
              {...form.register(f.name)}
            />
          )}
          <span className="field-error">
            {form.formState.errors[f.name]?.message}
          </span>
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
      <ErrorBox error={error} />
      {success && (
        <div role="status" className="success">
          Сохранено
        </div>
      )}
      <div>
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Сохраняем…" : label}
        </Button>
      </div>
    </form>
  );
}
