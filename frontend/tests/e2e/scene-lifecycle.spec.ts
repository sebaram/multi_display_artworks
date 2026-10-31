import { test, expect } from "@playwright/test";
import { ROOM, captureErrors } from "./helpers";
test("repeated SPA entries own only one scene and visitor panel", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.goto(`/room?room_id=${ROOM}`);
  for (let i = 0; i < 3; i++) {
    await expect(page.locator("a-scene canvas")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByRole("button", { name: "방문자", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("link", { name: "← 전시 목록" }).click();
    await expect(page.locator("a-scene")).toHaveCount(0);
    await expect(page.locator("#voice-ui")).toHaveCount(0);
    await page.locator(`a[href='/room?room_id=${ROOM}']`).first().click();
  }
  await expect(page.locator("a-scene")).toHaveCount(1);
  expect(errors).toEqual([]);
});
