export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const normalizeSubject = (value: string) =>
  value.trim().replace(/\s+/gu, " ");
export const normalizeTag = (value: string) =>
  value.trim().replace(/^#/, "").toLowerCase();
export const TAG_PATTERN = /^[\p{Script=Latin}\p{Script=Cyrillic}0-9_]{1,30}$/u;
export function daysLabel(days: number) {
  const last = days % 10,
    hundred = days % 100;
  return (
    days +
    " " +
    (hundred >= 11 && hundred <= 14
      ? "дней"
      : last === 1
        ? "день"
        : last >= 2 && last <= 4
          ? "дня"
          : "дней")
  );
}
