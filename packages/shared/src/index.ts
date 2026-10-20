export { BRAND } from "./brand";
export const ROLES = ["student", "tutor", "SUPERADMIN"] as const;
export type Role = (typeof ROLES)[number];
export const PAYMENT_STATUSES = [
  "pending",
  "awaiting_review",
  "approved",
  "rejected",
] as const;
export const SUBJECTS = [
  "Математика",
  "Английский язык",
  "Русский язык",
  "Физика",
  "Химия",
  "Биология",
  "Информатика",
  "История",
  "Казахский язык",
] as const;
export const LEVELS = [
  "Начальный",
  "Средний",
  "Продвинутый",
  "Подготовка к экзаменам",
] as const;
export const CURRENCY = "KZT" as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCESS_DAYS = 30;
