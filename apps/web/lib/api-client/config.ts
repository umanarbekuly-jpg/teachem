export const API_PREFIX = "/api/v1";
export function apiOrigin() {
  if (typeof window !== "undefined") return window.location.origin;
  return new URL(process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1")
    .origin;
}
export function apiURL(path: string) {
  return new URL(
    `${API_PREFIX}/${path.replace(/^\//, "")}`,
    apiOrigin(),
  ).toString();
}
