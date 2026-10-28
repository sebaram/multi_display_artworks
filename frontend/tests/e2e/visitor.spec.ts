import { test, expect } from "@playwright/test";
import { ROOM } from "./helpers";
const visitor = async (page: any) =>
  page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("metamuseum.tab-visitor.v1") || "null"),
  );
test("visitor identity survives reload, separates tabs and user=new", async ({
  page,
  context,
}) => {
  await page.goto(`/room?room_id=${ROOM}`);
  await expect.poll(async () => (await visitor(page))?.visitorId).toBeTruthy();
  const first = await visitor(page);
  await page.reload();
  await expect
    .poll(async () => (await visitor(page))?.visitorId)
    .toBe(first.visitorId);
  const other = await context.newPage();
  await other.goto(`/room?room_id=${ROOM}`);
  await expect.poll(async () => (await visitor(other))?.visitorId).toBeTruthy();
  expect((await visitor(other)).visitorId).not.toBe(first.visitorId);
  await page.goto(`/room?room_id=${ROOM}&user=new`);
  await expect
    .poll(async () => (await visitor(page))?.visitorId)
    .not.toBe(first.visitorId);
  await other.close();
});
