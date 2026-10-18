import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const money = (minor: number) =>
  new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const date = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Qyzylorda",
      }).format(new Date(value))
    : "—";
export const statusLabel: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "В архиве",
  pending: "Ожидает оплаты",
  awaiting_review: "На проверке",
  approved: "Подтверждён",
  rejected: "Отклонён",
  active: "Доступ открыт",
  inactive: "Не оплачен",
  expired: "Доступ истёк",
  paid: "Выплачено",
  scheduled: "Запланировано",
  cancelled: "Отменено",
  in_progress: "В процессе",
  submitted: "Завершён",
  student: "Ученик",
  tutor: "Тьютор",
  admin: "Администратор",
};
