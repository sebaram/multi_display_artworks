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
  const artwork = page.locator("[gaussian_splatting]");
  const waitForSource = async (count: number) => {
    await expect
      .poll(
        () =>
          artwork.evaluate(
            (el: any) => el.components?.gaussian_splatting?.loadedVertexCount,
          ),
        { timeout: 20000 },
      )
      .toBe(count);
    await expect
      .poll(
        () =>
          artwork.evaluate(
            (el: any) =>
              el.sceneEl.components["gaussian-splatting-system"].statistics
                .activeSplats,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    expect(
      await artwork.evaluate((el: any) => {
        const c = el.components.gaussian_splatting;
        const stats =
          el.sceneEl.components["gaussian-splatting-system"].statistics;
        return (
          !!c.splatMesh &&
          !c.boundingBox.isEmpty() &&
          stats.meshes === 1 &&
          stats.loadedVertexCount === c.loadedVertexCount
        );
      }),
    ).toBe(true);
  };
  const trackDisposal = () =>
    artwork.evaluate((el: any) => {
      const c = el.components.gaussian_splatting;
      const renderer =
        el.sceneEl.components["gaussian-splatting-system"].renderer;
      const mesh = c.splatMesh;
      const record: any = {
        component: c,
        mesh,
        renderer,
        controller: c.loadToken.controller,
        terminated: 0,
        disposed: new Set(),
        resources: [],
        textures: [],
      };
      (window as any).__splatRoom.components.push(record);
      const workers = [
        renderer.sortWorker?.worker,
        renderer.lodWorker?.worker,
      ].filter(Boolean);
      record.workers = workers.length;
      for (const worker of workers) {
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          record.terminated++;
          terminate();
        };
      }
      const targets = [
        ...new Set(
          [renderer.current, renderer.display, ...renderer.accumulators]
            .map((acc: any) => acc.target)
            .filter(Boolean),
        ),
      ] as any[];
      const textures = [
        ...mesh.extSplats.lodSplats.textures,
        mesh.rgbaDisplaceEdits?.sdfTexture,
        renderer.orderingTexture,
        ...targets.flatMap((target: any) => target.textures),
      ].filter(Boolean);
      const resources = [
        ...new Set(
          [
            renderer.geometry,
            renderer.material,
            renderer.orderingTexture,
            mesh.rgbaDisplaceEdits?.sdfTexture,
            ...mesh.extSplats.lodSplats.textures,
            ...targets,
          ].filter(Boolean),
        ),
      ];
      record.resources = resources;
      for (const resource of resources)
        resource.addEventListener("dispose", () =>
          record.disposed.add(resource),
        );
      record.gl = el.sceneEl.renderer.getContext();
      record.textures = [
        ...new Set(
          textures
            .map(
              (texture: any) =>
                el.sceneEl.renderer.properties.get(texture).__webglTexture,
            )
            .filter(Boolean),
        ),
      ];
      return {
        resources: resources.length,
        textures: record.textures.length,
        workers: workers.length,
      };
    });
  const disposed = () =>
    page.evaluate(() =>
      (window as any).__splatRoom.components.every(
        (r: any) =>
          r.component.disposed &&
          r.controller.signal.aborted &&
          !r.component.splatMesh &&
          !r.mesh.parent &&
          !r.renderer.parent &&
          r.renderer.isDisposed &&
          r.terminated === r.workers &&
          r.disposed.size === r.resources.length &&
          r.textures.length > 0 &&
          r.textures.every((texture: any) => !r.gl.isTexture(texture)),
      ),
    );
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
    await waitForSource(512);
    await page
      .locator("video")
      .evaluateAll((videos) =>
        videos.forEach((video) => (video as HTMLVideoElement).pause()),
      );
    expect(
      await artwork.evaluate((el: any) => {
        const c = el.components.gaussian_splatting;
        (window as any).__splatRoom = {
          scene: el.sceneEl,
          canvas: el.sceneEl.canvas,
          camera: el.sceneEl.camera,
          artwork: el,
          cutout: c.data.cutoutEntity,
          components: [],
        };
        return (
          c.cutoutSdf?.parent === c.data.cutoutEntity.object3D &&
          c.splatMesh.edits.length === 1
        );
      }),
    ).toBe(true);
    const clippedPixels = await page
      .locator("a-scene canvas")
      .screenshot({ path: "test-results/splat-clipped.png" });
    await artwork.evaluate((el: any) =>
      el.setAttribute("gaussian_splatting", "cutoutEntity", ""),
    );
    await expect
      .poll(() =>
        artwork.evaluate(
          (el: any) => el.components.gaussian_splatting.cutoutSdf,
        ),
      )
      .toBeNull();
    const unclippedPixels = await page
      .locator("a-scene canvas")
      .screenshot({ path: "test-results/splat-unclipped.png" });
    expect(clippedPixels.equals(unclippedPixels)).toBe(false);
    await artwork.evaluate((el: any) =>
      el.setAttribute(
        "gaussian_splatting",
        "cutoutEntity",
        (window as any).__splatRoom.cutout,
      ),
    );
    await expect
      .poll(() =>
        artwork.evaluate(
          (el: any) =>
            el.components.gaussian_splatting.cutoutSdf?.parent ===
            (window as any).__splatRoom.cutout.object3D,
        ),
      )
      .toBe(true);
    const first = await trackDisposal();
    expect(first.textures).toBeGreaterThan(0);
    expect(first.workers).toBe(2);
    const originalPixels = await page.locator("a-scene canvas").screenshot();
    await page
      .getByLabel("미디어 URL")
      .fill("http://127.0.0.1:8766/alternate.splat");
    await waitForSource(343);
    await expect.poll(disposed).toBe(true);
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
    await waitForSource(512);
    await expect.poll(disposed).toBe(true);
    expect(
      await artwork.evaluate((el: any) => {
        const previous = (window as any).__splatRoom;
        return (
          el === previous.artwork &&
          el.sceneEl === previous.scene &&
          el.sceneEl.canvas === previous.canvas &&
          el.sceneEl.camera === previous.camera &&
          el.components.gaussian_splatting.data.cutoutEntity ===
            previous.cutout &&
          el.components.gaussian_splatting.cutoutSdf.parent ===
            previous.cutout.object3D &&
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
    await expect.poll(disposed).toBe(true);
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
  await page
    .frameLocator('iframe[title="작품 웹페이지"]')
    .getByRole("button", { name: "Interact" })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="작품 웹페이지"]')
      .getByRole("button", { name: "Clicked" }),
  ).toBeVisible();
  await page.goto(
    "/element?wall_element_id=000000000000000000000019&type=webpage",
  );
  await page.getByRole("button", { name: "웹페이지 플레이어 열기" }).click();
  await expect(
    page.getByRole("link", { name: "원본 페이지 열기 ↗" }),
  ).toHaveAttribute("href", "http://127.0.0.1:8766/frame-blocked.html");
  await expect(page.getByText(/삽입 제한/)).toBeVisible();
});
