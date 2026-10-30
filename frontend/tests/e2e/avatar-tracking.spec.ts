import { test, expect, Page } from "@playwright/test";
import { ROOM } from "./helpers";
const room = process.env.AVATAR_TRACKING_ROOM || ROOM;
async function enter(page: Page) {
  await page.goto(`/room?room_id=${room}`);
  await expect(
    page.getByRole("button", { name: "Visitor", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  return page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("metamuseum.tab-visitor.v1")!),
  );
}
async function rig(page: Page, id: string) {
  return page.locator(`#camera-${id} .remote-avatar`).evaluate((el: any) => {
    const root = el.avatarInstance?.root;
    if (!root) return null;
    root.updateWorldMatrix(true, true);
    const T = (window as any).AFRAME.THREE;
    const point = (name: string) =>
      root.getObjectByName(name).getWorldPosition(new T.Vector3()).toArray();
    return {
      root: root.position.toArray(),
      scale: root.scale.x,
      head: point("HeadAnchor"),
      left: point("leftHand"),
      right: point("rightHand"),
      shoulder: point("leftUpperArm"),
      foot: point("leftFoot"),
      hips: point("hips"),
    };
  });
}
const distance = (a: number[], b: number[]) =>
  Math.hypot(...a.map((x, i) => x - b[i]));
async function worldAction(page: Page, label: string) {
  const fusing = await page.locator("a-scene").evaluate((scene: any, label) => {
    const target = [
      ...scene.querySelectorAll("#avatar-xr-panel .avatar-xr-action"),
    ].find(
      (e: any) => e.querySelector("a-text").getAttribute("value") === label,
    ) as any;
    const gaze = scene.querySelector("#camera a-cursor"),
      T = (window as any).AFRAME.THREE;
    scene.object3D.updateMatrixWorld(true);
    const origin = gaze.object3D.getWorldPosition(new T.Vector3());
    const direction = target.object3D
      .getWorldPosition(new T.Vector3())
      .sub(origin)
      .normalize();
    gaze.setAttribute("cursor", "fuseTimeout", 80);
    gaze.setAttribute("raycaster", {
      useWorldCoordinates: true,
      origin,
      direction,
    });
    gaze.components.raycaster.refreshObjects();
    gaze.components.raycaster.tock(performance.now());
    return gaze.is("cursor-fusing");
  }, label);
  expect(fusing).toBe(true);
  await page.waitForTimeout(160);
}
async function expected(page: Page, side: "head" | "left" | "right") {
  return page.evaluate((side) => {
    const w = window as any,
      T = w.AFRAME.THREE,
      origin = document.querySelector("#avatar-xr-origin") as any;
    origin.object3D.updateWorldMatrix(true, false);
    return new T.Vector3(...w.avatarXRMock[side])
      .applyMatrix4(origin.object3D.matrixWorld)
      .toArray();
  }, side);
}
test("actual A-Frame borrowed mock XR solves connected arms, transforms once, loses/recovers tracking, seats and ends safely", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const own = await enter(page);
  await page.getByRole("button", { name: "Visitor", exact: true }).click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page
    .getByLabel("Avatar preset", { exact: true })
    .selectOption("casual");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "My avatar" })).toHaveCount(0);
  const observer = await context.newPage();
  await enter(observer);
  await expect.poll(() => rig(observer, own.visitorId)).not.toBeNull();
  await expect(page.locator("#avatar-xr-origin")).toHaveCount(1);
  expect(
    await page
      .locator("#avatar-xr-panel .avatar-xr-action a-text")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("value"))),
  ).toEqual(
    expect.arrayContaining([
      "Standing",
      "Seated",
      "Calibrate",
      "Size -",
      "Size +",
    ]),
  );
  expect(
    await page
      .locator("[laser-controls]")
      .evaluateAll((nodes) => nodes.map((n) => n.parentElement?.id)),
  ).toEqual(["avatar-xr-origin", "avatar-xr-origin"]);
  await page.locator("#camera").evaluate((camera: any) => {
    camera.setAttribute("position", "-.7 1.64 -2");
    camera.components["look-controls"].yawObject.rotation.y = Math.PI;
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const w = window as any,
      scene = document.querySelector("a-scene") as any,
      xr = scene.renderer.xr;
    const mock = (w.avatarXRMock = {
      head: [0, 1.1, 0],
      left: [-0.32, 0.85, -0.25],
      right: [0.32, 0.85, -0.25],
      lost: false,
      hands: false,
      active: true,
      endCalls: 0,
      reference: {},
      original: {
        getSession: xr.getSession,
        getFrame: xr.getFrame,
        getReferenceSpace: xr.getReferenceSpace,
      },
    });
    const pose = (p: number[]) => ({
      transform: {
        position: { x: p[0], y: p[1], z: p[2] },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
    const session = new EventTarget() as any;
    session.end = () => {
      mock.endCalls++;
    };
    Object.defineProperty(session, "inputSources", {
      get: () =>
        mock.lost
          ? []
          : ["left", "right"].map((side) => ({
              handedness: side,
              gripSpace: { side },
              targetRaySpace: { side: "ray" },
              ...(mock.hands ? { hand: new Map([["wrist", { side }]]) } : {}),
            })),
    });
    mock.session = session;
    mock.frame = {
      session,
      getViewerPose: (r: any) => {
        if (r !== mock.reference) throw Error("wrong reference");
        return pose(mock.head);
      },
      getPose: (s: any) => pose(s.side === "ray" ? [99, 99, 99] : mock[s.side]),
      getJointPose: (s: any) => pose(mock[s.side]),
    };
    xr.getSession = () => (mock.active ? mock.frame.session : null);
    xr.getReferenceSpace = () => mock.reference;
    xr.getFrame = () => mock.frame;
  });
  await expect(
    page.getByLabel("Avatar posture", { exact: true }),
  ).toBeVisible();
  expect((await rig(observer, own.visitorId))!.scale).toBeCloseTo(1, 3);
  await page.locator("a-scene").evaluate((s: any) => s.emit("enter-vr"));
  await worldAction(page, "Seated");
  await expect(page.getByLabel("Avatar posture", { exact: true })).toHaveValue(
    "seated",
  );
  await page.evaluate(() => {
    const m = (window as any).avatarXRMock;
    m.head[1] = 1.64;
    m.left[1] = 1.26;
    m.right[1] = 1.26;
  });
  await worldAction(page, "Standing");
  await expect(page.getByLabel("Avatar posture", { exact: true })).toHaveValue(
    "standing",
  );
  await worldAction(page, "Size +");
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.scale)
    .toBeCloseTo(1.69 / 1.64, 3);
  await worldAction(page, "Calibrate");
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.scale)
    .toBeCloseTo(1, 3);
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.left,
        await expected(page, "left"),
      ),
    )
    .toBeLessThan(0.035);
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.right,
        await expected(page, "right"),
      ),
    )
    .toBeLessThan(0.035);
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.head,
        await expected(page, "head"),
      ),
    )
    .toBeLessThan(0.015);
  const connected = (await rig(observer, own.visitorId))!;
  expect(distance(connected.left, connected.shoulder)).toBeLessThan(0.531);
  await page.evaluate(() => {
    const w = window as any,
      o = (document.querySelector("#avatar-xr-origin") as any).object3D;
    w.avatarXRMock.hands = true;
    o.position.x += 1.3;
    o.position.z -= 0.7;
    o.rotation.y += 0.6;
  });
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.left,
        await expected(page, "left"),
      ),
    )
    .toBeLessThan(0.035);
  expect(
    await page.evaluate(() => {
      const root = (
        document.querySelector("a-scene") as any
      ).object3D.getObjectByName("avatar-owner");
      return {
        visible: root.visible,
        headScale: root.getObjectByName("head").scale.x,
      };
    }),
  ).toEqual({ visible: true, headScale: 0.00001 });
  await page.locator("#camera").evaluate((camera: any) => {
    camera.setAttribute("position", "-1 1.6 -2.5");
    camera.setAttribute("rotation", "0 180 0");
    camera.emit("avatar-teleport", {}, false);
  });
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.root[0])
    .toBeCloseTo(-1, 2);
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.left,
        await expected(page, "left"),
      ),
    )
    .toBeLessThan(0.035);
  const tracked = (await rig(observer, own.visitorId))!;
  await page.evaluate(() => {
    (window as any).avatarXRMock.lost = true;
  });
  await page.waitForTimeout(150);
  expect(
    distance((await rig(observer, own.visitorId))!.left, tracked.left),
  ).toBeLessThan(0.04);
  await expect
    .poll(async () =>
      distance((await rig(observer, own.visitorId))!.left, tracked.left),
    )
    .toBeGreaterThan(0.12);
  await page.evaluate(() => {
    (window as any).avatarXRMock.lost = false;
  });
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.left,
        await expected(page, "left"),
      ),
    )
    .toBeLessThan(0.035);
  await page.evaluate(() => {
    const m = (window as any).avatarXRMock;
    m.head[1] = 1.05;
    m.left[1] = 0.85;
    m.right[1] = 0.85;
  });
  await worldAction(page, "Seated");
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.head,
        await expected(page, "head"),
      ),
    )
    .toBeLessThan(0.015);
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.foot[1])
    .toBeCloseTo(0.08, 2);
  const seated = (await rig(observer, own.visitorId))!;
  expect(seated.scale).toBeCloseTo(1, 3);
  expect(seated.hips[1]).toBeLessThan(0.6);
  expect(seated.foot[1]).toBeCloseTo(0.08, 2);
  await page
    .getByLabel("Avatar posture", { exact: true })
    .selectOption("standing");
  await page.evaluate(() => {
    const m = (window as any).avatarXRMock;
    m.head[1] = 1.64;
    m.left[1] = 1.26;
    m.right[1] = 1.26;
  });
  await observer.locator("#camera").evaluate((c: any) => {
    c.setAttribute("position", "1 1.6 2");
    c.components["look-controls"].yawObject.rotation.y = 0;
  });
  await expect
    .poll(async () =>
      distance(
        (await rig(observer, own.visitorId))!.head,
        await expected(page, "head"),
      ),
    )
    .toBeLessThan(0.015);
  await observer.screenshot({
    path: "test-results/avatar-tracking-mock-xr.png",
  });
  await page.evaluate(() => {
    const m = (window as any).avatarXRMock;
    m.active = false;
    m.session.dispatchEvent(new Event("end"));
  });
  await page.locator("a-scene").evaluate((s: any) => s.emit("exit-vr"));
  await expect
    .poll(() =>
      page
        .locator("#avatar-xr-origin")
        .evaluate((e: any) => e.object3D.position.length()),
    )
    .toBeLessThan(0.001);
  expect(await page.evaluate(() => (window as any).avatarXRMock.endCalls)).toBe(
    0,
  );
  await page.evaluate(() => {
    const s = document.querySelector("a-scene") as any,
      m = (window as any).avatarXRMock;
    s.setAttribute("webxr", {
      referenceSpaceType: "local",
      requiredFeatures: [],
      optionalFeatures: ["hand-tracking", "local-floor"],
    });
    const next = new EventTarget() as any;
    Object.defineProperty(next, "inputSources", {
      get: () => m.session.inputSources,
    });
    m.head = [0, 0, 0];
    m.left = [-0.32, -0.38, -0.25];
    m.right = [0.32, -0.38, -0.25];
    m.frame.session = next;
    m.active = true;
  });
  await expect(
    page.getByLabel("Avatar posture", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.head[1])
    .toBeCloseTo(1.64, 2);
  await expect
    .poll(async () => (await rig(observer, own.visitorId))!.foot[1])
    .toBeCloseTo(0.08, 2);
  if (
    !(await page
      .getByRole("button", { name: "Customize", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "Visitor", exact: true }).click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByLabel("Avatar preset", { exact: true }).selectOption("robot");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const legacyHand = observer.locator(`#hand-left-${own.visitorId}`);
  await expect(legacyHand).toHaveCount(1);
  const palm = () =>
    legacyHand
      .locator("a-box")
      .evaluate((p: any) =>
        p.object3D
          .getWorldPosition(new (window as any).AFRAME.THREE.Vector3())
          .toArray(),
      );
  await expect
    .poll(async () => distance(await palm(), await expected(page, "left")))
    .toBeLessThan(0.02);
  await observer.evaluate((id) => {
    (window as any).avatarLegacyHandNode = document.getElementById(
      `hand-left-${id}`,
    );
  }, own.visitorId);
  await page.evaluate(() => {
    (window as any).avatarXRMock.left[0] -= 0.05;
  });
  await expect
    .poll(async () => distance(await palm(), await expected(page, "left")))
    .toBeLessThan(0.02);
  expect(
    await legacyHand.evaluate(
      (el: any) => el === (window as any).avatarLegacyHandNode,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const s = document.querySelector("a-scene") as any,
      w = window as any;
    w.avatarXRResetCount = 0;
    s.addEventListener(
      "avatar-xr-origin-changed",
      () => w.avatarXRResetCount++,
    );
    s.emit("avatar-calibration", { posture: "seated" }, false);
  });
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => (window as any).avatarXRResetCount),
  ).toBeLessThanOrEqual(2);
  await page.evaluate(() => {
    const m = (window as any).avatarXRMock;
    m.active = false;
    m.frame.session.dispatchEvent(new Event("end"));
  });
  await page.evaluate(() => {
    const s = document.querySelector("a-scene") as any,
      m = (window as any).avatarXRMock;
    Object.assign(s.renderer.xr, m.original);
  });
  expect(errors).toEqual([]);
});
