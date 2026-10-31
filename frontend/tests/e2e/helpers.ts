import { expect, Page } from "@playwright/test";
export const ROOM = "000000000000000000000001";
export async function login(page: Page, email = "admin@migration.invalid") {
  await page.goto("/signin?next=/kwanri");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("Migration-local-123!");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(page).toHaveURL(/kwanri/);
  await expect(page.getByRole("heading", { name: "공간 관리" })).toBeVisible();
}
export function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
export async function mutate(
  page: Page,
  path: string,
  method: string,
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrf_token } = await (await fetch("/api/v1/auth/csrf")).json();
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf_token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok)
        throw Error(`${response.status} ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}
