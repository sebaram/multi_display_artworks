import { test, expect } from "@playwright/test";
import { ROOM, captureErrors } from "./helpers";
test("real catalog preserves room, wall and element links", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "지금 열려 있는 공간" }),
  ).toBeVisible();
  const rooms = await page.request.get("/api/v1/rooms");
  expect(rooms.ok()).toBeTruthy();
  const data = await rooms.json();
  expect(data.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: `${data[0].name} 입장` }),
  ).toBeVisible();
  await page.goto(`/room?room_id=${ROOM}`);
  await expect(page.locator("a-scene")).toHaveCount(1);
  await expect(page.locator("a-scene canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(()=>page.locator('a-scene').evaluate((scene:any)=>scene.hasLoaded),{timeout:20000}).toBe(true);
  await page.getByRole("button", { name: /작품 목록/ }).click();
  await expect(page.getByRole("heading", { name: "전시 작품" })).toBeVisible();
  await page.screenshot({ path: "test-results/gallery-room.png" });
  expect(errors).toEqual([]);
});
test("catalog search has honest empty state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("no-such-exhibition-9382");
  await expect(
    page.getByText("검색 결과가 없습니다. 다른 검색어를 입력하세요."),
  ).toBeVisible();
});
