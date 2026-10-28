import { test, expect } from "@playwright/test";
import { login, captureErrors } from "./helpers";
test("room create edit reload and delete through actual forms", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await login(page);
  await page.goto("/kwanri/rooms");
  await page.getByRole("button", { name: "+ 새로 만들기" }).click();
  const name = `브라우저 전시 ${Date.now()}`;
  await page.locator("#field-name").fill(name);
  await page
    .locator("#field-description")
    .fill("실제 API 저장과 공개 화면 검증");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page.getByText("저장했습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "편집 닫기" }).click();
  await page.reload();
  await expect(
    page.getByRole("button").filter({ hasText: name }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: name }).click();
  await expect(page.locator("#field-name")).toHaveValue(name);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByRole("button").filter({ hasText: name })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
test("all 11 resources expose usable schema forms", async ({ page }) => {
  await login(page);
  const schema = await (await page.request.get("/api/v1/admin/schema")).json();
  expect(schema.resources).toHaveLength(11);
  for (const resource of schema.resources) {
    await page.goto(`/kwanri/${resource.name}`);
    await page.getByRole("button", { name: "+ 새로 만들기" }).click();
    await expect(page.locator(".admin-inspector form")).toBeVisible();
    const editable = resource.fields.filter((field: any) => !field.readonly);
    expect(editable.length).toBeGreaterThan(0);
    for (const field of editable)
      await expect(page.locator(`#field-${field.name}`)).toBeVisible();
  }
});
