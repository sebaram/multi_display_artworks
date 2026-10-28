import { test, expect } from "@playwright/test";
import { ROOM, captureErrors } from "./helpers";
test("actual splat cutout reduces rendered points and disposal stops its worker", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.goto(
    `/element?wall_element_id=000000000000000000000016&type=gaussian_splat`,
  );
  await expect
    .poll(
      () =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) => el.components?.gaussian_splatting?.loadedVertexCount,
          ),
      { timeout: 20000 },
    )
    .toBe(512);
  await expect
    .poll(
      () =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) =>
              el.components.gaussian_splatting.splatMesh.geometry.instanceCount,
          ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  const clipped = await page
    .locator("[gaussian_splatting]")
    .evaluate((el: any) => {
      const c = el.components.gaussian_splatting;
      (window as any).__splat = c;
      return c.splatMesh.geometry.instanceCount;
    });
  expect(clipped).toBeLessThan(512);
  const clippedPixels = await page
    .locator("a-scene canvas")
    .screenshot({ path: "test-results/splat-clipped.png" });
  await page.locator("[gaussian_splatting]").evaluate((el: any) => {
    el.components.gaussian_splatting.cutout = null;
  });
  await expect
    .poll(() =>
      page
        .locator("[gaussian_splatting]")
        .evaluate(
          (el: any) =>
            el.components.gaussian_splatting.splatMesh.geometry.instanceCount,
        ),
    )
    .toBeGreaterThan(clipped);
  const unclippedPixels = await page
    .locator("a-scene canvas")
    .screenshot({ path: "test-results/splat-unclipped.png" });
  expect(clippedPixels.equals(unclippedPixels)).toBe(false);
  await page.getByRole("link", { name: "← 전시 목록" }).click();
  expect(await page.evaluate(() => (window as any).__splat.disposed)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test("real wall video advances with native or HLS player and image background renders", async ({
  page,
}) => {
  await page.goto(`/wall?wall_id=00000000000000000000000b`);
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .first()
          .evaluate((el: HTMLVideoElement) => el.currentTime),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0.2);
  await expect(page.locator("a-video")).toHaveCount(1);
  await page.goto(`/wall?wall_id=00000000000000000000000c`);
  await expect(page.locator("a-image")).toHaveCount(1);
  await expect
    .poll(
      () =>
        page
          .locator("a-image")
          .evaluate(
            (el: any) =>
              !!el.getObject3D("mesh")?.material?.map?.image?.complete,
          ),
      { timeout: 15000 },
    )
    .toBe(true);
});
test("allowed webpage is usable in DOM player and blocked page retains external link", async ({
  page,
}) => {
  await page.goto(
    "/element?wall_element_id=000000000000000000000018&type=webpage",
  );
  await page.getByRole("button", { name: "웹페이지 플레이어 열기" }).click();
  await expect(
    page.frameLocator('iframe[title="작품 웹페이지"]').locator("body"),
  ).toContainText("Migration frame allowed");
  await page.frameLocator('iframe[title="작품 웹페이지"]').getByRole('button',{name:'Interact'}).click();
  await expect(page.frameLocator('iframe[title="작품 웹페이지"]').getByRole('button',{name:'Clicked'})).toBeVisible();
  await page.goto(
    "/element?wall_element_id=000000000000000000000019&type=webpage",
  );
  await page.getByRole("button", { name: "웹페이지 플레이어 열기" }).click();
  await expect(
    page.getByRole("link", { name: "원본 페이지 열기 ↗" }),
  ).toHaveAttribute("href", "http://127.0.0.1:8766/frame-blocked.html");
  await expect(page.getByText(/삽입 제한/)).toBeVisible();
});
