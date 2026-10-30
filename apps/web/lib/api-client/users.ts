import { apiURL } from "./config";
import { secureFetch } from "./index";
export type ManagedUser = {
  id: string;
  name: string;
  surname: string;
  email: string;
  phone: string;
  bio: string;
  photoAssetId: string | null;
  photoUrl?: string | null;
  role: "student" | "tutor" | "SUPERADMIN";
  blockedAt: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  mustChangePassword: boolean;
  profile: null | {
    bio: string;
    photoAssetId: string | null;
    experienceYears: number;
    education: string;
    subjects: string[];
    languages: string[];
  };
};
export class FieldError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function accountRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await secureFetch(
    new Request(apiURL(path), {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const data = await response.json();
  if (!response.ok)
    throw new FieldError(
      data.message ?? "Не удалось выполнить запрос",
      data.fields ??
        Object.fromEntries(
          (data.details ?? []).map((v: string) => [v.split(" ")[0], v]),
        ),
    );
  return data as T;
}
export const userApi = {
  list: (query: URLSearchParams) =>
    accountRequest<{
      items: ManagedUser[];
      total: number;
      page: number;
      pageSize: number;
    }>("admin/users?" + query),
  get: (id: string) => accountRequest<ManagedUser>("admin/users/" + id),
  create: (body: unknown) =>
    accountRequest<ManagedUser>("admin/users", "POST", body),
  update: (id: string, body: unknown) =>
    accountRequest<ManagedUser>("admin/users/" + id, "PATCH", body),
  role: (id: string, role: string) =>
    accountRequest("admin/users/" + id + "/role", "POST", { role }),
  reset: (id: string, body: unknown) =>
    accountRequest("admin/users/" + id + "/password", "POST", body),
  block: (id: string, blocked: boolean) =>
    accountRequest(
      "admin/users/" + id + (blocked ? "/block" : "/unblock"),
      "POST",
    ),
};
