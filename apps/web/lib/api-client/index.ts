import { apiOrigin, apiURL } from "./config";
import createClient from "openapi-fetch";
import type { paths } from "./schema";
let csrf: string | undefined;
let refreshPromise: Promise<boolean> | undefined;
async function csrfToken() {
  if (!csrf) {
    const response = await fetch(apiURL("auth/csrf"), {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Не удалось подключиться к серверу");
    csrf = (await response.json()).token;
  }
  return csrf!;
}
export async function secureFetch(request: Request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
    request.headers.set("X-CSRF-Token", await csrfToken());
  const retry = request.clone();
  let response = await fetch(request, { credentials: "include" });
  if (
    response.status === 401 &&
    !/\/auth\/(login|register|refresh)/.test(request.url)
  ) {
    refreshPromise ??= (async () => {
      try {
        return (
          await fetch(apiURL("auth/refresh"), {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRF-Token": await csrfToken() },
          })
        ).ok;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = undefined;
    });
    if (await refreshPromise)
      response = await fetch(retry, { credentials: "include" });
  }
  if (response.status === 403) csrf = undefined;
  return response;
}
export const api = createClient<paths>({
  baseUrl: apiOrigin(),
  fetch: secureFetch,
});
export async function result<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const r = await promise;
  if (!r.response.ok) {
    const error = r.error as
      { message?: string; details?: string[] } | undefined;
    throw new Error(
      error?.details?.join(". ") ||
        error?.message ||
        "Не удалось выполнить запрос",
    );
  }
  return r.data as T;
}
export async function uploadFile(
  file: File,
  purpose: "material" | "receipt" | "avatar" | "course_cover",
) {
  const upload = await result(
    api.POST("/api/v1/files/uploads", {
      body: {
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose,
      },
    }),
  );
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields))
    form.append(key, value);
  form.append("file", file);
  const response = await fetch(upload.url, { method: "POST", body: form });
  if (!response.ok) throw new Error("Не удалось загрузить файл");
  await result(
    api.POST("/api/v1/files/{id}/complete", {
      params: { path: { id: upload.id } },
    }),
  );
  return upload.id;
}
export async function downloadFile(id: string) {
  const data = await result(
    api.GET("/api/v1/files/{id}/download", { params: { path: { id } } }),
  );
  window.location.assign(data.url);
}
