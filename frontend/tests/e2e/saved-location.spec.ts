import { test, expect } from "@playwright/test";
import { login, mutate } from "./helpers";
test("capture current camera pose, refresh the selector without remount, reload and teleport", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `Camera capture ${Date.now()}`,
    description: "Owned location capture acceptance",
  });
  let presetId: string | undefined;
  try {
    await page.goto(`/room?room_id=${room.id}`);
    await expect(page.locator("#voice-admin-btn")).toBeVisible({
      timeout: 20000,
    });
    await page.locator("a-camera").evaluate((camera: any) => {
      (window as any).__captureScene = document.querySelector("a-scene");
      camera.setAttribute("position", "1.2 1.7 2.3");
      camera.setAttribute("rotation", "-10 37 0");
      camera.components["look-controls"].pitchObject.rotation.x =
        (-10 * Math.PI) / 180;
      camera.components["look-controls"].yawObject.rotation.y =
        (37 * Math.PI) / 180;
    });
    await page
      .getByRole("button", { name: "현재 위치 저장", exact: true })
      .click();
    await page
      .getByLabel("장소 이름", { exact: true })
      .fill("Captured viewpoint");
    await page.getByRole("button", { name: "위치 저장", exact: true }).click();
    const saved = page.getByRole("option", {
      name: "Captured viewpoint",
      exact: true,
    });
    await expect(saved).toHaveCount(1);
    presetId = (await saved.getAttribute("value"))!;
    expect(
      await page.evaluate(
        () =>
          (window as any).__captureScene === document.querySelector("a-scene"),
      ),
    ).toBe(true);
    const persisted = await (
      await page.request.get(`/api/v1/admin/locations/${presetId}`)
    ).json();
    expect(persisted.position_x).toBeCloseTo(1.2);
    expect(persisted.position_y).toBeCloseTo(1.7);
    expect(persisted.position_z).toBeCloseTo(2.3);
    expect(persisted.rotation_x).toBeCloseTo(-10);
    expect(persisted.rotation_y).toBeCloseTo(37);
    await page.reload();
    await expect(
      page.getByRole("option", { name: "Captured viewpoint" }),
    ).toHaveCount(1);
    await expect(page.locator("#voice-admin-btn")).toBeVisible();
    await page.locator("a-camera").evaluate((camera: any) => {
      camera.setAttribute("position", "0 1.6 0");
      camera.setAttribute("rotation", "0 0 0");
    });
    await page.getByLabel("지정 위치로 이동").selectOption(presetId);
    await expect
      .poll(() =>
        page
          .locator("a-camera")
          .evaluate((camera: any) => camera.object3D.position.x),
      )
      .toBeCloseTo(1.2);
    expect(
      await page
        .locator("a-camera")
        .evaluate(
          (camera: any) => (camera.object3D.rotation.y * 180) / Math.PI,
        ),
    ).toBeCloseTo(37);
  } finally {
    if (presetId)
      await mutate(page, `/api/v1/admin/locations/${presetId}`, "DELETE");
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});
