import { test, expect } from "@playwright/test";
import { copyFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureErrors, login, mutate } from "./helpers";
test("actual splat source replacement preserves clipping and disposes each old component", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const filename = `migration-source-${randomUUID()}.splat`;
  const staticFile = fileURLToPath(
    new URL(
      `../../../backend/metamuseum/static/splats/${filename}`,
      import.meta.url,
    ),
  );
  const originalSource = `static/splats/${filename}`;
  await copyFile(
    fileURLToPath(new URL("../fixtures/media/cloud.splat", import.meta.url)),
    staticFile,
  );
  let id: string | undefined;
  try {
    await login(page);
    const original = await (
      await page.request.get("/api/v1/admin/splats/000000000000000000000016")
    ).json();
    const schema = await (
      await page.request.get("/api/v1/admin/schema")
    ).json();
    const fields = schema.resources.find(
      (r: any) => r.name === "splats",
    ).fields;
    const body = Object.fromEntries(
      fields
        .filter((f: any) => !f.readonly && original[f.name] !== undefined)
        .map((f: any) => [f.name, original[f.name]]),
    );
    const owned = await mutate(page, "/api/v1/admin/splats", "POST", {
      ...body,
      name: `Source reload ${filename}`,
      splat_url: originalSource,
    });
    id = owned.id;
    await page.goto(`/element?wall_element_id=${id}&type=gaussian_splat`);
    await expect(page.getByLabel("미디어 URL")).toHaveValue(originalSource);
    await page.getByLabel("가로 X", { exact: true }).fill("0.6");
    expect(
      await page
        .locator(".room-inspector form")
        .evaluate((form: HTMLFormElement) => form.checkValidity()),
    ).toBe(true);
    await page.getByRole("button", { name: "작품 변경 저장" }).click();
    await expect(
      page.getByText("저장했습니다.", { exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/v1/admin/splats/${id}`)).json())
        .splat_url,
    ).toBe(originalSource);
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
                el.components.gaussian_splatting.splatMesh.geometry
                  .instanceCount,
            ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    const clipped = await page
      .locator("[gaussian_splatting]")
      .evaluate((el: any) => {
        const c = el.components.gaussian_splatting;
        return c.splatMesh.geometry.instanceCount;
      });
    expect(clipped).toBeLessThan(512);
    await page
      .locator("video")
      .evaluateAll((videos) =>
        videos.forEach((video) => (video as HTMLVideoElement).pause()),
      );
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
    await page.locator("[gaussian_splatting]").evaluate((el: any) => {
      const c = el.components.gaussian_splatting;
      c.cutout = c.data.cutoutEntity.object3D;
      (window as any).__splatRoom = {
        scene: el.sceneEl,
        canvas: el.sceneEl.canvas,
        camera: el.sceneEl.camera,
        artwork: el,
        cutout: c.cutout,
        components: [],
      };
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
      .toBe(clipped);
    const trackDisposal = async () =>
      page.locator("[gaussian_splatting]").evaluate((el: any) => {
        const c = el.components.gaussian_splatting;
        const record: any = {
          component: c,
          terminated: false,
          cancelled: false,
          disposed: [],
        };
        (window as any).__splatRoom.components.push(record);
        const terminate = c.worker.terminate.bind(c.worker);
        c.worker.terminate = () => {
          record.terminated = true;
          terminate();
        };
        const cancel = c.reader.cancel.bind(c.reader);
        c.reader.cancel = () => {
          record.cancelled = true;
          return cancel();
        };
        const resources = {
          geometry: c.splatMesh.geometry,
          material: c.splatMesh.material,
          centers: c.centerAndScaleTexture,
          colors: c.covAndColorTexture,
        };
        for (const [name, resource] of Object.entries(resources) as any)
          resource.addEventListener("dispose", () =>
            record.disposed.push(name),
          );
        const gl = c.renderer.getContext();
        record.gl = gl;
        record.textures = [c.centerAndScaleTexture, c.covAndColorTexture].map(
          (t) => c.renderer.properties.get(t).__webglTexture,
        );
      });
    const disposed = () =>
      page.evaluate(() =>
        (window as any).__splatRoom.components.every(
          (r: any) =>
            r.component.disposed &&
            r.component.abortController.signal.aborted &&
            r.terminated &&
            r.cancelled &&
            r.disposed.length === 4 &&
            !r.component.splatMesh.parent &&
            r.textures.every((t: any) => !r.gl.isTexture(t)),
        ),
      );
    await trackDisposal();
    const originalPixels = await page.locator("a-scene canvas").screenshot();
    await page
      .getByLabel("미디어 URL")
      .fill("http://127.0.0.1:8766/alternate.splat");
    await expect
      .poll(() =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) => el.components.gaussian_splatting.loadedVertexCount,
          ),
      )
      .toBe(343);
    await expect
      .poll(() =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) =>
              el.components.gaussian_splatting.splatMesh.geometry.instanceCount,
          ),
      )
      .toBeGreaterThan(0);
    const alternateCount = await page
      .locator("[gaussian_splatting]")
      .evaluate(
        (el: any) =>
          el.components.gaussian_splatting.splatMesh.geometry.instanceCount,
      );
    expect(alternateCount).toBeLessThan(343);
    expect(await disposed()).toBe(true);
    const alternatePixels = await page
      .locator("a-scene canvas")
      .screenshot({ path: "test-results/splat-replaced.png" });
    expect(originalPixels.equals(alternatePixels)).toBe(false);
    await page.getByRole("button", { name: "작품 변경 저장" }).click();
    await expect(
      page.getByText("저장했습니다.", { exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/v1/admin/splats/${id}`)).json())
        .splat_url,
    ).toBe("http://127.0.0.1:8766/alternate.splat");
    await trackDisposal();
    await page.getByLabel("미디어 URL").fill(originalSource);
    await expect
      .poll(() =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) => el.components.gaussian_splatting.loadedVertexCount,
          ),
      )
      .toBe(512);
    await expect
      .poll(() =>
        page
          .locator("[gaussian_splatting]")
          .evaluate(
            (el: any) =>
              el.components.gaussian_splatting.splatMesh.geometry.instanceCount,
          ),
      )
      .toBe(clipped);
    expect(await disposed()).toBe(true);
    expect(
      await page.locator("[gaussian_splatting]").evaluate((el: any) => {
        const previous = (window as any).__splatRoom;
        return (
          el === previous.artwork &&
          el.sceneEl === previous.scene &&
          el.sceneEl.canvas === previous.canvas &&
          el.sceneEl.camera === previous.camera &&
          el.components.gaussian_splatting.cutout === previous.cutout &&
          el.getAttribute("position").x === 0.6
        );
      }),
    ).toBe(true);
    await page.getByRole("button", { name: "작품 변경 저장" }).click();
    await expect(
      page.getByText("저장했습니다.", { exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/v1/admin/splats/${id}`)).json())
        .splat_url,
    ).toBe(originalSource);
    await trackDisposal();
    await page.getByRole("link", { name: "← 전시 목록" }).click();
    expect(await disposed()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    try {
      if (id) {
        await page.goto("/");
        await mutate(page, `/api/v1/admin/splats/${id}`, "DELETE");
      }
    } finally {
      await unlink(staticFile);
    }
  }
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
