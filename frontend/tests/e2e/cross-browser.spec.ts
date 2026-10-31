import { test, expect, firefox, webkit } from "@playwright/test";
import { captureErrors, login } from "./helpers";

for (const browserName of ["firefox", "webkit"] as const) {
  test(`${browserName}: catalog, keyboard, actual login and mobile layout`, async ({
    baseURL,
  }) => {
    const browser = await { firefox, webkit }[browserName].launch();
    const context = await browser.newContext({
      baseURL,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      const errors = captureErrors(page);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "지금 열려 있는 공간" }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "본문으로 건너뛰기" }),
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#main-content')).toBeFocused();
      await page
        .getByRole("searchbox")
        .fill("no-such-exhibition-cross-browser");
      await expect(
        page.getByText("검색 결과가 없습니다. 다른 검색어를 입력하세요."),
      ).toBeVisible();
      await login(page);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "공간 관리" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.getByRole("searchbox")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("link", { name: /로그아웃/ }).click();
      await expect(page).toHaveURL("/");
      expect(
        (await (await page.request.get("/api/v1/auth/session")).json())
          .authenticated,
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
