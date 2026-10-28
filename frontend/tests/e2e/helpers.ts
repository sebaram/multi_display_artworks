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
