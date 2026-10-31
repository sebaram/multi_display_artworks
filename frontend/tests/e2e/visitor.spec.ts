import { test, expect, type Page } from "@playwright/test";
import { ROOM } from "./helpers";
async function visitorReady(page: Page) {
  await expect(
    page.getByRole("button", { name: "Visitor", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const visitor = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("metamuseum.tab-visitor.v1") || "null"),
  );
  expect(visitor?.visitorId).toBeTruthy();
  expect(visitor?.capability).toBeTruthy();
  return visitor;
}

test("visitor identity survives reload, separates tabs and user=new", async ({
  page,
  context,
}) => {
  await page.goto(`/room?room_id=${ROOM}`);
  const first = await visitorReady(page);
  await page.reload();
  expect(await visitorReady(page)).toMatchObject({
    visitorId: first.visitorId,
    capability: first.capability,
  });
  const other = await context.newPage();
  await other.goto(`/room?room_id=${ROOM}`);
  const second = await visitorReady(other);
  expect(second.visitorId).not.toBe(first.visitorId);
  expect(second.capability).not.toBe(first.capability);
  await page.goto(`/room?room_id=${ROOM}&user=new`);
  const replacement = await visitorReady(page);
  expect(replacement.visitorId).not.toBe(first.visitorId);
  expect(replacement.capability).not.toBe(first.capability);
  await other.close();
});
