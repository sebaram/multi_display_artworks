import { test, expect } from "@playwright/test";
import { login, mutate } from "./helpers";
test("normal artwork form saves root-relative and path-relative media unchanged", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  const unique = Date.now();
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `Relative source ${unique}`,
    description: "Owned relative-media acceptance",
  });
  const wall = await mutate(page, "/api/v1/admin/walls", "POST", {
    name: `Relative wall ${unique}`,
    description: "Owned wall",
    room: room.id,
    position: "0 1.6 -3",
    rotation: "0 0 0",
    width: 6,
    height: 4,
    depth: 0.2,
  });
  const image = await mutate(page, "/api/v1/admin/images", "POST", {
    name: `Relative image ${unique}`,
    description: "Owned image",
    wall: wall.id,
    position: "0 0 0",
    position_x: 0,
    position_y: 0,
    width: 1,
    height: 1,
    image_url: "/static/img/cheesecake.png",
  });
  try {
    await page.goto(`/room?room_id=${room.id}`);
    await expect(page.locator("#voice-admin-btn")).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole("button", { name: /작품 목록/ }).click();
    await page
      .getByRole("button", {
        name: new RegExp(`Relative image ${unique} 이미지`),
      })
      .click();
    await page.evaluate(
      () =>
        ((window as any).__relativeScene = document.querySelector("a-scene")),
    );
    for (const [source, position] of [
      ["/static/img/cheesecake.png", "0.3"],
      ["static/img/cheesecake.png", "0.6"],
    ]) {
      await page.getByLabel("미디어 URL", { exact: true }).fill(source);
      await page.getByLabel("가로 X", { exact: true }).fill(position);
      expect(
        await page
          .locator(".room-inspector form")
          .evaluate((form: HTMLFormElement) => form.checkValidity()),
      ).toBe(true);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().endsWith(`/images/${image.id}`),
      );
      await page.getByRole("button", { name: "작품 변경 저장" }).click();
      expect((await saved).status()).toBe(200);
      const actual = await (
        await page.request.get(`/api/v1/elements/image/${image.id}`)
      ).json();
      expect(actual.image_url).toBe(source);
      expect(actual.position_x).toBe(Number(position));
      expect(
        await page.evaluate(
          () =>
            (window as any).__relativeScene ===
            document.querySelector("a-scene"),
        ),
      ).toBe(true);
    }
    await page
      .getByLabel("미디어 URL", { exact: true })
      .fill("javascript:alert(1)");
    expect(
      await page
        .locator(".room-inspector form")
        .evaluate((form: HTMLFormElement) => form.checkValidity()),
    ).toBe(false);
  } finally {
    await mutate(page, `/api/v1/admin/images/${image.id}`, "DELETE");
    await mutate(page, `/api/v1/admin/walls/${wall.id}`, "DELETE");
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});
