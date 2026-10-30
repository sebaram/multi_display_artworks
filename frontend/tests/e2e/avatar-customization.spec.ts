import { test, expect, Page } from '@playwright/test';
import { ROOM, login, mutate } from './helpers';
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

test('account switches with no anonymous saved preference restore the anonymous tab look', async ({ page }) => {
  test.setTimeout(60000);
  const initial = await enter(page);
  const anonymous = await profile(page);
  expect((await page.request.get('/api/v1/me/avatar').then(r => r.json())).appearance).toBeNull();
  await login(page);
  await enter(page); await customize(page);
  await page.getByLabel('Avatar preset', { exact: true }).selectOption('explorer');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
  await mutate(page, '/api/v1/auth/signin', 'POST', { email: 'visitor@migration.invalid', password: 'Migration-local-123!', next: '/' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Visitor', exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/me/avatar').then(r => r.json())).appearance).toBeNull();
  expect(await profile(page)).toMatchObject({ displayName: anonymous.displayName, avatarId: 'shiba', color: '#4CAF50' });
  await page.goto('/logout'); await expect(page).toHaveURL(/\/$/);
  const restored = await enter(page);
  expect(restored.visitorId).toBe(initial.visitorId);
  expect(restored.capability).toBe(initial.capability);
  expect(await profile(page)).toMatchObject({ displayName: anonymous.displayName, avatarId: anonymous.avatarId, color: anonymous.color });
  expect((await page.request.get('/api/v1/me/avatar').then(r => r.json())).appearance).toBeNull();
});

for (const transition of ['empty account', 'logout'] as const) {
  test(`open editor reload resolves the new ${transition} owner without publishing the previous account look`, async ({ page, context }) => {
    test.setTimeout(60000);
    await enter(page);
    const anonymous = await profile(page);
    await login(page); await enter(page); await customize(page);
    await page.getByLabel('Avatar preset', { exact: true }).selectOption('explorer');
    await color(page, 'top color', '#a13579');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
    const accountProfile = await profile(page);
    const visitor = await page.evaluate(() => JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')!));
    const other = await context.newPage(); await enter(other);
    await expect.poll(() => remoteLook(other, visitor.visitorId)).toMatchObject({ presetId: 'explorer', colors: { top: '#A13579' } });
    await customize(page);
    if (transition === 'empty account') {
      await mutate(other, '/api/v1/auth/signin', 'POST', { email: 'visitor@migration.invalid', password: 'Migration-local-123!', next: '/' });
    } else await mutate(other, '/api/v1/auth/signout', 'POST');
    expect((await other.request.get('/api/v1/me/avatar').then(r => r.json())).appearance).toBeNull();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('conflict');
    await page.getByRole('button', { name: 'Reload saved appearance' }).click();
    const expected = transition === 'empty account' ? { avatarId: 'shiba', color: '#4CAF50' } : anonymous;
    await expect(page.getByLabel('Avatar preset', { exact: true })).toHaveValue(expected.avatarId);
    await expect(page.getByLabel('top color', { exact: true })).toHaveValue(expected.color.toLowerCase());
    expect(await profile(page)).toEqual(accountProfile);
    expect((await remoteLook(other, visitor.visitorId)).colors.top).toBe('#A13579');
    if (transition === 'logout') {
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'My avatar' })).toHaveCount(0);
      const saved = await page.request.get('/api/v1/me/avatar').then(r => r.json());
      expect(saved.appearance).toMatchObject({ presetId: expected.avatarId, colors: { top: expected.color } });
      expect(saved.appearance.colors.top).not.toBe('#A13579');
      await expect.poll(() => remoteLook(other, visitor.visitorId)).toMatchObject({ presetId: expected.avatarId, colors: { top: expected.color } });
    } else {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await customize(page);
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('conflict');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect((await other.request.get('/api/v1/me/avatar').then(r => r.json())).appearance).toBeNull();
    }
    await other.close();
  });
}

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

async function aimFuse(page: Page, label: string, exitAfterIntersection = false) {
  return page.locator('a-scene').evaluate((scene: any, { text, exitAfterIntersection }) => {
    const panel = scene.querySelector('#avatar-xr-panel');
    const target = [...panel.querySelectorAll('.avatar-xr-action')].find((el: any) => el.querySelector('a-text').getAttribute('value') === text) as any;
    const gaze = scene.querySelector('#camera a-cursor');
    const THREE = (window as any).AFRAME.THREE;
    scene.object3D.updateMatrixWorld(true);
    const origin = gaze.object3D.getWorldPosition(new THREE.Vector3());
    const point = target.object3D.getWorldPosition(new THREE.Vector3());
    const direction = point.sub(origin).normalize();
    gaze.setAttribute('cursor', 'fuseTimeout', 80);
    gaze.setAttribute('raycaster', { useWorldCoordinates: true, origin, direction });
    gaze.components.raycaster.refreshObjects();
    gaze.components.raycaster.tock(performance.now());
    const fusing = gaze.is('cursor-fusing');
    if (exitAfterIntersection) scene.emit('exit-vr');
    return fusing;
  }, { text: label, exitAfterIntersection });
}

test('hidden XR controls cannot raycast or fuse Apply outside immersive mode', async ({ page }) => {
  await enter(page);
  expect(await page.locator('a-scene').evaluate((scene: any) =>
    [...scene.querySelectorAll('[laser-controls], #camera a-cursor')].map((el: any) => el.components.raycaster.data.enabled)
  )).toEqual([false, false, false]);
  const before = await page.request.get('/api/v1/me/avatar').then(r => r.json());
  await page.locator('a-scene').evaluate((scene: any) => { scene.emit('enter-vr'); scene.emit('exit-vr'); });
  await aimFuse(page, 'Apply');
  // Wait past the real bundled cursor's short fuse, then inspect persistence.
  await page.waitForTimeout(250);
  const after = await page.request.get('/api/v1/me/avatar').then(r => r.json());
  expect(after.revision).toBe(before.revision);
  const input = await page.locator('a-scene').evaluate((scene: any) => ({
    own: [...scene.querySelectorAll('[laser-controls], #camera a-cursor')].map((el: any) => el.components.raycaster.data.enabled),
    app: scene.components.raycaster.data.enabled,
    fusing: scene.querySelector('#camera a-cursor').is('cursor-fusing'),
  }));
  expect(input.own).toEqual([false, false, false]);
  expect(input.app).toBe(true);
  expect(input.fusing).toBe(false);
});

test('exit cancels a pending real fuse and deferred Apply cannot change a later XR panel status', async ({ page }) => {
  await enter(page);
  const scene = page.locator('a-scene');
  await scene.evaluate((el: any) => el.emit('enter-vr'));
  expect(await aimFuse(page, 'Apply', true)).toBe(true);
  await page.waitForTimeout(250);
  expect((await page.request.get('/api/v1/me/avatar').then(r => r.json())).revision).toBe(0);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const request = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/v1/me/avatar', async route => {
    if (route.request().method() === 'PUT') { arrived(); await held; }
    await route.continue();
  });
  await scene.evaluate((el: any) => el.emit('enter-vr'));
  const selectedPreset = (await profile(page)).avatarId === 'casual' ? 'explorer' : 'casual';
  await page.locator('#avatar-xr-panel .avatar-xr-action').evaluateAll((targets, preset) => {
    const label = preset === 'casual' ? 'Casual' : 'Explorer';
    (targets.find(el => el.querySelector('a-text')?.getAttribute('value') === label) as any).emit('click');
  }, selectedPreset);
  await aimFuse(page, 'Apply');
  await request;
  await scene.evaluate((el: any) => {
    el.emit('exit-vr');
    el.querySelector('#camera a-cursor').setAttribute('raycaster', { useWorldCoordinates: false, origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } });
    el.emit('enter-vr');
  });
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/me/avatar') && r.request().method() === 'PUT');
  release(); await response;
  await expect.poll(async () => (await profile(page)).avatarId).toBe(selectedPreset);
  await expect.poll(() => page.locator('#avatar-xr-panel > a-text').evaluate((el: any) => el.getAttribute('value'))).toBe('My avatar - select, Apply or Revert');
});
