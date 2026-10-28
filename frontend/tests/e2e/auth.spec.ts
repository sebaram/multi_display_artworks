import { test, expect } from "@playwright/test";
import { login, captureErrors } from "./helpers";
test("real bcrypt login and CSRF logout survive reload", async ({ page }) => {
  const errors = captureErrors(page);
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "공간 관리" })).toBeVisible();
  await page.getByRole("link", { name: /로그아웃/ }).click();
  await expect(page).toHaveURL("/");
  const session = await page.request.get("/api/v1/auth/session");
  expect((await session.json()).authenticated).toBe(false);
  expect(errors).toEqual([]);
});
test("bad credentials remain an accessible form error", async ({ page }) => {
  await page.goto("/signin");
  await page
    .getByLabel("이메일", { exact: true })
    .fill("admin@migration.invalid");
  await page.getByLabel("비밀번호", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL("/signin");
});
