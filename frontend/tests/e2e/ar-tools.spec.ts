import { test, expect } from "@playwright/test";
import { ROOM } from "./helpers";
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});
test("phone marker events move receiver and continuous poses retain configured target", async ({
  page,
  context,
}) => {
  const receiver = await context.newPage();
  await receiver.goto(`/room?room_id=${ROOM}&ar=companion`);
  await expect(receiver.locator("#camera")).toHaveCount(1);
  await expect
    .poll(
      () => receiver.locator("a-scene").evaluate((el: any) => el.hasLoaded),
      { timeout: 20000 },
    )
    .toBe(true);
  await page.goto(`/ar-companion?room_id=${ROOM}`);
  await page.getByRole("button", { name: "카메라 시작", exact: true }).click();
  await expect(page.locator("a-marker")).toHaveCount(1, { timeout: 20000 });
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/ar-companion/status?room_id=${ROOM}`,
      );
      return (await response.json()).phones_count;
    })
    .toBe(1);
  const marker = await page.locator("a-marker").getAttribute("id");
  await receiver
    .locator("#camera")
    .evaluate((el: any) => el.setAttribute("position", "3 1.6 2"));
  await page
    .locator("a-marker")
    .evaluate((el: any) => el.emit("markerFound", {}));
  await expect
    .poll(() =>
      receiver
        .locator("#camera")
        .evaluate((el: any) => el.getAttribute("position").x),
    )
    .toBe(0);
  await page.waitForTimeout(350);
  await expect
    .poll(() =>
      receiver
        .locator("#camera")
        .evaluate((el: any) => el.getAttribute("position").x),
    )
    .toBe(0);
  await page.getByRole("button", { name: "카메라·연결 종료" }).click();
  await expect(page.locator("a-scene")).toHaveCount(0);
  await receiver.close();
  expect(marker).toContain("ar-marker-");
});
test("gesture target assignments and actual touchpoint relay are usable", async ({
  page,
  context,
}) => {
  await page.goto("/gesture-mark/test?targets=6");
  const other = await context.newPage();
  await other.goto("/gesture-mark/test?targets=6");
  await expect(
    page.getByText("Socket.IO 연결됨", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".target-grid button")).toHaveCount(6);
  await page.getByRole("button", { name: "right", exact: true }).click();
  await page.getByRole("button", { name: "할당 제스처 보내기" }).click();
  await expect(other.getByText(/최근 제스처: right/)).toBeVisible();
  const pad = page.locator(".gesture-pad");
  const box = await pad.boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect(other.locator(".gesture-pad>span")).not.toHaveCount(0);
  await other.close();
});
