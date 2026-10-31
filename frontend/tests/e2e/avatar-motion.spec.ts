import { test, expect, Page } from "@playwright/test";
import { ROOM } from "./helpers";
async function enter(page: Page) {
  await page.goto(`/room?room_id=${ROOM}`);
  await expect(
    page.getByRole("button", { name: "방문자", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  return page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("metamuseum.tab-visitor.v1")!),
  );
}
async function body(page: Page, id: string) {
  return page.locator(`#camera-${id} .remote-avatar`).evaluate((el: any) => {
    const root = el.avatarInstance?.root;
    if (!root) return null;
    root.updateMatrixWorld(true);
    const T = (window as any).AFRAME.THREE;
    const point = (name: string) =>
      root.getObjectByName(name).getWorldPosition(new T.Vector3()).toArray();
    return {
      position: root.position.toArray(),
      up: new T.Vector3(0, 1, 0).applyQuaternion(root.quaternion).toArray(),
      head: root.getObjectByName("head").quaternion.toArray(),
      hips: root.getObjectByName("hips").quaternion.toArray(),
      left: point("leftFoot"),
      right: point("rightFoot"),
      headWorld: point("HeadAnchor"),
      anchor: el.parentElement.object3D.position.toArray(),
      leg: root.getObjectByName("leftUpperLeg").quaternion.toArray(),
    };
  });
}
const horizontalDistance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);
test("owner walking, head independence, planted feet, teleport, stationary late join and reconnect at desktop/mobile", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const own = await enter(page);
  await page.getByRole("button", { name: "방문자", exact: true }).click();
  await page.getByRole("button", { name: "외형 설정", exact: true }).click();
  await page
    .getByLabel("아바타 프리셋", { exact: true })
    .selectOption("casual");
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "내 아바타" })).toHaveCount(0);
  const observer = await context.newPage();
  await enter(observer);
  await expect.poll(() => body(observer, own.visitorId)).not.toBeNull();
  await page.locator("#camera").evaluate((el: any) => {
    el.setAttribute("position", "-1 1.6 -3");
    el.components["look-controls"].yawObject.rotation.y = Math.PI;
  });
  await observer
    .locator("#camera")
    .evaluate((el: any) => el.setAttribute("position", "0 1.6 2"));
  await expect
    .poll(async () =>
      Math.abs((await body(observer, own.visitorId))!.position[0] + 1),
    )
    .toBeLessThan(0.02);
  await page.locator("#camera").evaluate((el: any) => {
    el.components["look-controls"].pitchObject.rotation.x = 0.6;
    el.components["look-controls"].yawObject.rotation.y = Math.PI + 0.4;
  });
  await expect
    .poll(async () => Math.abs((await body(observer, own.visitorId))!.head[0]))
    .toBeGreaterThan(0.2);
  const tilted = (await body(observer, own.visitorId))!;
  expect(
    Math.hypot(...tilted.up.map((x: number, i: number) => x - [0, 1, 0][i])),
  ).toBeLessThan(0.001);
  expect(
    Math.hypot(
      ...tilted.headWorld.map((x: number, i: number) => x - tilted.anchor[i]),
    ),
  ).toBeLessThan(0.03);
  const idle = (await body(observer, own.visitorId))!;
  // Form typing keeps its focus and must not drive the camera.
  if (
    !(await page.getByRole("button", { name: "편집", exact: true }).isVisible())
  )
    await page.getByRole("button", { name: "방문자", exact: true }).click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const beforeTyping = await page
    .locator("#camera")
    .evaluate((el: any) => el.object3D.position.toArray());
  await page.locator("#profile-display-name").pressSequentially("wasd");
  expect(
    await page
      .locator("#camera")
      .evaluate((el: any) => el.object3D.position.toArray()),
  ).toEqual(beforeTyping);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.bringToFront();
  await page.locator("a-scene canvas.a-canvas").click({ position: { x: 300, y: 200 } });
  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.up("w");
  await expect
    .poll(async () =>
      Math.hypot(
        ...(await body(observer, own.visitorId))!.position.map(
          (x: number, i: number) => x - idle.position[i],
        ),
      ),
    )
    .toBeGreaterThan(0.2);
  await expect
    .poll(() =>
      page
        .locator("#camera")
        .evaluate((el: any) =>
          el.components["wasd-controls"].velocity.length(),
        ),
    )
    .toBe(0);
  const planted = await page.locator("a-scene").evaluate((scene: any) => {
    const root = scene.object3D.getObjectByName("avatar-owner");
    root.updateWorldMatrix(true, true);
    return root
      .getObjectByName("leftFoot")
      .getWorldPosition(new (window as any).AFRAME.THREE.Vector3())
      .toArray();
  });
  // Start measuring after the observer has applied the stationary owner's pose.
  await expect
    .poll(async () =>
      Math.hypot(
        ...(await body(observer, own.visitorId))!.left.map(
          (x: number, i: number) => x - planted[i],
        ),
      ),
    )
    .toBeLessThan(0.005);
  const settled = (await body(observer, own.visitorId))!;
  await observer.waitForTimeout(180);
  const still = (await body(observer, own.visitorId))!;
  expect(
    Math.hypot(
      ...settled.left.map((x: number, i: number) => x - still.left[i]),
    ),
  ).toBeLessThan(0.015);
  expect(still.left[1]).toBeGreaterThan(0.04);
  expect(still.left[1]).toBeLessThan(0.12);
  await page.keyboard.down("s");
  await page.waitForTimeout(500);
  await page.keyboard.up("s");
  await page.locator("#camera").evaluate((el: any) => {
    el.setAttribute("position", "1 1.6 -3");
    el.emit("avatar-teleport", {}, false);
    el.components["look-controls"].pitchObject.rotation.x = 0;
    el.components["look-controls"].yawObject.rotation.y = Math.PI;
  });
  await expect
    .poll(async () => (await body(observer, own.visitorId))!.position[0])
    .toBeCloseTo(1, 1);
  const tele = (await body(observer, own.visitorId))!;
  expect(Math.abs(tele.left[0] - 1)).toBeLessThan(0.3);
  await observer.screenshot({ path: "test-results/avatar-motion-desktop.png" });
  const late = await context.newPage();
  await enter(late);
  await expect.poll(() => body(late, own.visitorId)).not.toBeNull();
  await expect
    .poll(async () => (await body(late, own.visitorId))!.position[0])
    .toBeCloseTo(1, 1);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(observer.locator(`#camera-${own.visitorId}`)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => body(observer, own.visitorId)).not.toBeNull();
  await expect
    .poll(async () => (await body(observer, own.visitorId))!.position[0])
    .toBeCloseTo(1, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.bringToFront();
  await page.locator("a-scene canvas.a-canvas").click({ position: { x: 170, y: 400 } });
  await page.keyboard.down("w");
  await page.waitForTimeout(350);
  await page.keyboard.up("w");
  await observer.setViewportSize({ width: 390, height: 844 });
  await observer.screenshot({ path: "test-results/avatar-motion-mobile.png" });
  expect(errors).toEqual([]);
  await late.close();
  await observer.close();
});

test("390px coarse-pointer analog joystick drives the owner body shown to a peer", async ({
  browser,
}) => {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await mobile.newPage();
  const owner = await enter(page);
  await page.getByRole("button", { name: "방문자", exact: true }).click();
  await page.getByRole("button", { name: "외형 설정", exact: true }).click();
  await page
    .getByLabel("아바타 프리셋", { exact: true })
    .selectOption("sporty");
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "내 아바타" })).toHaveCount(0);
  const observer = await mobile.newPage();
  await enter(observer);
  await expect.poll(() => body(observer, owner.visitorId)).not.toBeNull();
  await page.bringToFront();
  const before = await page
    .locator("#camera")
    .evaluate((el: any) => el.object3D.position.toArray());
  await expect
    .poll(async () =>
      horizontalDistance(
        (await body(observer, owner.visitorId))!.position,
        before,
      ),
    )
    .toBeLessThan(0.03);
  const beforeBody = (await body(observer, owner.visitorId))!.position;
  const joystick = page.getByRole("group", { name: "이동 조이스틱", exact: true });
  await expect(joystick).toBeVisible();
  const rect = (await joystick.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 - 56);
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect
    .poll(async () =>
      horizontalDistance(
        await page
          .locator("#camera")
          .evaluate((el: any) => el.object3D.position.toArray()),
        before,
      ),
    )
    .toBeGreaterThan(0.2);
  await expect
    .poll(async () =>
      horizontalDistance(
        (await body(observer, owner.visitorId))!.position,
        beforeBody,
      ),
    )
    .toBeGreaterThan(0.2);
  const ownerAfter = await page
    .locator("#camera")
    .evaluate((el: any) => el.object3D.position.toArray());
  const observerAfter = (await body(observer, owner.visitorId))!.position;
  await test
    .info()
    .attach("mobile-horizontal-motion", {
      contentType: "application/json",
      body: JSON.stringify({
        ownerBefore: before,
        ownerAfter,
        observerBefore: beforeBody,
        observerAfter,
        ownerXZ: horizontalDistance(ownerAfter, before),
        observerXZ: horizontalDistance(observerAfter, beforeBody),
      }),
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await observer.screenshot({
    path: "test-results/avatar-motion-touch-joystick.png",
  });
  await mobile.close();
});
