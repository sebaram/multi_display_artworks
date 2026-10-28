import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import path from "node:path";

const wall = "00000000000000000000000b";
test.use({
  launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader"] },
});
test("real Mongo preset, media, apply, reload and concurrent conflict", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const initial = await (
    await page.request.get(`/api/v1/walls/${wall}/design`)
  ).json();
  expect(initial).toBeNull();
  let presetId = "",
    assetIds: string[] = [];
  const unsafe = async (url: string, method: string) =>
    page.evaluate(
      async ({ url, method }) => {
        const csrf = await (
          await fetch("/api/v1/auth/csrf", { credentials: "include" })
        ).json();
        return (
          await fetch(url, {
            method,
            credentials: "include",
            headers: { "X-CSRF-Token": csrf.csrf_token },
          })
        ).status;
      },
      { url, method },
    );
  try {
    await page.goto(`/wall-editor?wall_id=${wall}`);
    await expect(
      page.getByRole("heading", { name: "월 디자인 스튜디오" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await (await page.request.get("/api/v1/wall-presets")).json()
          ).filter((p: any) => p.read_only).length,
      )
      .toBe(44);
    await page.getByLabel("프리셋 검색").fill("Blue Hour");
    const blue = page
      .locator(".preset-grid button")
      .filter({ has: page.getByText("Blue Hour", { exact: true }) });
    await expect(blue).toHaveCount(1);
    await blue.click();
    const name = `Editor integration ${Date.now()}`;
    await page.getByLabel("이름", { exact: true }).fill(name);
    await page.getByLabel("밝기", { exact: true }).fill("63");
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/wall-presets") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    let preset = await createResponse.json();
    presetId = preset.id;
    expect(preset.config.state.brightness).toBe(63);
    await expect(
      page.getByText("프리셋을 저장했습니다. 월에는 아직 적용되지 않았습니다."),
    ).toBeVisible();
    expect(
      await (await page.request.get(`/api/v1/walls/${wall}/design`)).json(),
    ).toBeNull();
    await page.getByRole("button", { name: /영상 추가/ }).click();
    const upload = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/wall-assets") &&
        r.request().method() === "POST",
    );
    await page
      .getByLabel("영상 업로드")
      .setInputFiles(path.resolve("tests/fixtures/media/video.mp4"));
    const uploaded = await upload;
    expect(uploaded.status()).toBe(201);
    const asset = await uploaded.json();
    assetIds.push(asset.id);
    await expect(page.getByText(/현재 소스:/)).toContainText(asset.name);
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/wall-presets/${presetId}`) &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    expect((await saved).status()).toBe(200);
    preset = await (
      await page.request.get(`/api/v1/wall-presets/${presetId}`)
    ).json();
    expect(
      preset.config.state.videoLayers.some((v: any) => v.assetId === asset.id),
    ).toBeTruthy();
    const thumbUpload = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/wall-assets") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "썸네일 생성" }).click();
    const thumbResponse = await thumbUpload;
    expect(thumbResponse.status()).toBe(201);
    assetIds.push((await thumbResponse.json()).id);
    await expect(page.getByText("썸네일을 저장했습니다.")).toBeVisible();
    preset = await (
      await page.request.get(`/api/v1/wall-presets/${presetId}`)
    ).json();
    expect(preset.thumbnail_asset_id).toBe(assetIds[1]);
    expect((await page.request.get(preset.thumbnail_url)).status()).toBe(200);
    await page.getByRole("button", { name: "월에 적용" }).click();
    await expect(
      page.getByText("현재 초안을 월에 적용했습니다."),
    ).toBeVisible();
    const applied = await (
      await page.request.get(`/api/v1/walls/${wall}/design`)
    ).json();
    expect(applied.config.state.brightness).toBe(63);
    expect(applied.asset_ids).toContain(asset.id);
    await page.reload();
    await expect(page.getByLabel("밝기", { exact: true })).toHaveValue("63");
    await page.getByLabel("프리셋 검색").fill(name);
    await page.locator(".preset-grid button").filter({ hasText: name }).click();
    const second = await context.newPage();
    await second.goto(`/wall-editor?wall_id=${wall}`);
    await expect(second.getByText(/적용 버전/)).toBeVisible({ timeout: 30000 });
    await second.getByLabel("프리셋 검색").fill(name);
    await second
      .locator(".preset-grid button")
      .filter({ hasText: name })
      .click();
    await page.getByLabel("밝기", { exact: true }).fill("64");
    const patch = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/wall-presets/${presetId}`) &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    expect((await patch).status()).toBe(200);
    await second.getByLabel("밝기", { exact: true }).fill("65");
    const conflict = second.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/wall-presets/${presetId}`) &&
        r.request().method() === "PATCH",
    );
    await second.getByRole("button", { name: "저장", exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(second.getByRole("alert")).toContainText("409");
    await expect(second.getByLabel("밝기", { exact: true })).toHaveValue("65");
    expect(
      (await (await page.request.get(`/api/v1/walls/${wall}/design`)).json())
        .config.state.brightness,
    ).toBe(63);
    const appliedAgain = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/walls/${wall}/design`) &&
        r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "월에 적용" }).click();
    expect((await appliedAgain).status()).toBe(200);
    const staleApply = second.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/walls/${wall}/design`) &&
        r.request().method() === "PUT",
    );
    await second.getByRole("button", { name: "월에 적용" }).click();
    expect((await staleApply).status()).toBe(409);
    await expect(second.getByRole("alert")).toContainText("409");
    await expect(second.getByLabel("밝기", { exact: true })).toHaveValue("65");
    expect(
      (await (await page.request.get(`/api/v1/walls/${wall}/design`)).json())
        .config.state.brightness,
    ).toBe(64);
    await second.close({ runBeforeUnload: false });
    expect(errors).toEqual([]);
  } finally {
    const binding = await (
      await page.request.get(`/api/v1/walls/${wall}/design`)
    ).json();
    if (binding)
      expect(
        await unsafe(
          `/api/v1/walls/${wall}/design?expected_revision=${binding.revision}`,
          "DELETE",
        ),
      ).toBe(204);
    if (presetId) {
      const current = await (
        await page.request.get(`/api/v1/wall-presets/${presetId}`)
      ).json();
      if (current?.revision)
        expect(
          await unsafe(
            `/api/v1/wall-presets/${presetId}?expected_revision=${current.revision}`,
            "DELETE",
          ),
        ).toBe(204);
    }
    for (const id of assetIds)
      expect(await unsafe(`/api/v1/wall-assets/${id}`, "DELETE")).toBe(204);
  }
});
