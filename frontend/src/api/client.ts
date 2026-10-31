import { translate as t } from "../app/i18n";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
let csrf: string | null = null;
export async function refreshCsrf() {
  const r = await fetch("/api/v1/auth/csrf", { credentials: "include" });
  if (!r.ok)
    throw new ApiError(
      r.status,
      t(
        "보안 토큰을 가져오지 못했습니다.",
        "Unable to retrieve the security token.",
      ),
    );
  csrf = (await r.json()).csrf_token;
  return csrf!;
}
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const unsafe =
    init.method &&
    !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase());
  if (unsafe) {
    headers.set("X-CSRF-Token", csrf || (await refreshCsrf()));
    if (!(init.body instanceof FormData))
      headers.set("Content-Type", "application/json");
  }
  const r = await fetch(path, { ...init, headers, credentials: "include" });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    let message =
      data?.detail ||
      data?.message ||
      t("요청을 처리하지 못했습니다.", "Unable to complete the request.");
    if (Array.isArray(message))
      message = message
        .map((v: any) => `${v.loc?.slice(-1)[0] || ""}: ${v.msg}`)
        .join("\n");
    if (typeof message !== "string") message = JSON.stringify(message);
    throw new ApiError(r.status, message, data);
  }
  return data;
}
export const write = (path: string, method: string, value?: unknown) =>
  api(path, {
    method,
    body: value === undefined ? undefined : JSON.stringify(value),
  });
export function safeNext(value: string | null) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/";
}
