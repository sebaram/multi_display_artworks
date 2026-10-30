import { test, expect, Page } from '@playwright/test';
import { ROOM } from './helpers';
const route = `/room?room_id=${ROOM}`;
async function enter(page: Page) {
  await page.goto(route);
  await expect(page.getByRole('button', { name: 'Visitor', exact: true })).toBeVisible({ timeout: 20000 });
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')!));
}
async function customize(page: Page) {
  await page.getByRole('button', { name: 'Visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My avatar' })).toBeVisible();
}
async function color(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}
const profile = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')!).profile);
const remoteLook = (page: Page, visitorId: string) => page.locator(`#camera-${visitorId}`).evaluate((el: any) => JSON.parse(el.getAttribute('data-profile-key'))[2]);

test('two tabs save isolated looks, cancel stays private, late join and reconnect preserve appearance', async ({ page, context }) => {
  test.setTimeout(60000);
  const first = await enter(page), other = await context.newPage();
  const second = await enter(other);
  expect(second.visitorId).not.toBe(first.visitorId);
  await customize(page);
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('casual');
  const previewCanvas = await page.getByRole('dialog', { name: 'My avatar' }).locator('canvas').elementHandle();
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('sporty');
  expect(await previewCanvas!.evaluate(canvas => canvas === document.querySelector('dialog[aria-label="My avatar"] canvas'))).toBe(true);
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('casual');
  await color(page, 'top color', '#ff0000');
  await page.getByLabel('face', { exact: true }).selectOption('calm');
  await page.getByLabel('glasses', { exact: true }).selectOption('round');
  await page.getByLabel('Rotate preview').fill('45');
  await page.getByLabel('Zoom preview').fill('2.1');
  await page.screenshot({ path: 'test-results/avatar-editor-desktop.png' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
  await expect.poll(() => remoteLook(other, first.visitorId)).toMatchObject({ presetId: 'casual', colors: { top: '#FF0000' }, faceId: 'calm' });
  await customize(other);
  await other.getByRole('button', { name: 'Reload saved appearance' }).click();
  await other.getByLabel('Avatar preset', { exact: true }).selectOption('sporty');
  await color(other, 'top color', '#0000ff');
  await other.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(other.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
  await expect.poll(() => remoteLook(page, second.visitorId)).toMatchObject({ colors: { top: '#0000FF' } });
  expect((await profile(page)).appearance.colors.top).toBe('#FF0000');
  const late = await context.newPage(); await enter(late);
  await expect.poll(() => remoteLook(late, first.visitorId)).toMatchObject({ colors: { top: '#FF0000' } });
  await expect.poll(() => remoteLook(late, second.visitorId)).toMatchObject({ colors: { top: '#0000FF' } });
  const palette = await late.locator(`#camera-${first.visitorId} .remote-avatar`).evaluate(async (el: any) => {
    const instance = await el.avatarReady;
    return instance.root.getObjectByName('Body').material.userData.avatarColors.top.value.getHexString();
  });
  expect(palette).toBe('ff0000');
  await customize(page);
  await color(page, 'top color', '#00ff00');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await remoteLook(other, first.visitorId)).colors.top).toBe('#FF0000');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(other.locator(`#camera-${first.visitorId}`)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => remoteLook(other, first.visitorId)).toMatchObject({ colors: { top: '#FF0000' } });
  await page.reload(); await expect(page.getByRole('button', { name: 'Visitor', exact: true })).toBeVisible();
  await expect.poll(() => profile(page)).toMatchObject({ appearance: { colors: { top: '#0000FF' } } });
  const previousName = (await profile(page)).displayName;
  await page.getByRole('button', { name: 'Visitor', exact: true }).click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'New visitor', exact: true }).click()]);
  await expect(page.getByRole('button', { name: 'Visitor', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')!).visitorId)).not.toBe(first.visitorId);
  expect((await profile(page)).appearance.colors.top).toBe('#0000FF');
  expect(previousName).toBeTruthy();
  await late.close(); await other.close();
});

test('stale tab Apply reports revision conflict, keeps draft and supports reload at mobile width', async ({ page, context }) => {
  await enter(page); const other = await context.newPage(); await enter(other);
  await page.setViewportSize({ width: 390, height: 844 });
  await customize(page); await customize(other);
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('explorer');
  await other.getByLabel('Avatar preset', { exact: true }).selectOption('casual');
  await other.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(other.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('conflict');
  await expect(page.getByLabel('Avatar preset', { exact: true })).toHaveValue('explorer');
  await page.screenshot({ path: 'test-results/avatar-editor-mobile-conflict.png' });
  expect(await page.getByRole('dialog', { name: 'My avatar' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reload saved appearance' }).click();
  await expect(page.getByLabel('Avatar preset', { exact: true })).toHaveValue('casual');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await other.close();
});

test('failed GLB loading leaves an explicit preview fallback and usable editor', async ({ page }) => {
  await page.route('**/avatars/common-humanoid.glb', route => route.abort());
  await enter(page); await customize(page);
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('casual');
  await expect(page.getByRole('status').filter({ hasText: 'Preview unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
});

test('world preset panel selects, reverts and saves without a DOM editor', async ({ page }) => {
  await enter(page);
  await page.locator('a-scene').evaluate((scene: any) => scene.emit('enter-vr'));
  const panel = page.locator('#avatar-xr-panel');
  await expect.poll(() => panel.evaluate((el: any) => el.object3D.visible)).toBe(true);
  const action = async (label: string) => panel.locator('a-plane.avatar-xr-action').evaluateAll((targets, text) => {
    const selected: any = targets.find(el => el.querySelector('a-text')?.getAttribute('value') === text);
    selected.emit('click');
  }, label);
  await action('Explorer'); await action('Revert');
  await action('Humanoid Robot'); await action('Apply');
  await expect.poll(() => profile(page)).toMatchObject({ appearance: { presetId: 'humanoid-robot' } });
  await page.locator('a-scene').evaluate((scene: any) => scene.emit('exit-vr'));
  await expect.poll(() => panel.evaluate((el: any) => el.object3D.visible)).toBe(false);
});
