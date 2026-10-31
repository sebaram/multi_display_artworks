import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { mountProfilePanel } from '../../src/scene/legacy/profile-panel.js';
import { mountMinimap } from '../../src/scene/legacy/minimap.js';
import { mountMobileGuidance } from '../../src/scene/legacy/mobile-guidance.js';
import { mountShare } from '../../src/scene/legacy/ui/share.js';
import { createVoiceChat } from '../../src/scene/voice-chat.js';

const cleanup: (() => void)[] = [];
beforeEach(() => {
  setLocale('en');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('updates an open profile editor without losing its draft, focus or connection error', () => {
  const panel = mountProfilePanel({ document, catalog: { robot: { label: 'Robot' } },
    profile: { displayName: 'My name', avatarId: 'robot', color: '#123456' }, onSave: vi.fn(), onCustomize: undefined });
  cleanup.push(panel.destroy);
  panel.open();
  const edit = [...document.querySelectorAll('button')].find(button => button.textContent === 'Edit')!;
  edit.click();
  const dialog = document.querySelector('dialog')!;
  const name = document.querySelector<HTMLInputElement>('#profile-display-name')!;
  name.value = 'Unpublished name'; name.focus();
  panel.showConnectionError();
  setLocale('ko');
  expect(document.querySelector('dialog')).toBe(dialog);
  expect(dialog.open).toBe(true);
  expect(name.value).toBe('Unpublished name');
  expect(document.activeElement).toBe(name);
  expect(edit.textContent).toBe('편집');
  expect(document.querySelector('#profile-dialog-title')?.textContent).toBe('방문자 프로필');
  expect(document.querySelector('option')?.textContent).toBe('로봇');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('방문자 연결');
  panel.destroy();
  setLocale('en');
  expect(edit.textContent).toBe('편집');
});

it('updates expanded map and mobile guidance in place', () => {
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any);
  const map = mountMinimap({ document, boundary: { min_x: 0, max_x: 10, min_z: 0, max_z: 10 },
    getCamera: () => null, requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() });
  cleanup.push(map.destroy);
  map.canvas.click();
  const guidance = mountMobileGuidance({ document, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  cleanup.push(guidance.destroy);
  const hint = document.getElementById('mobile-movement-guidance');
  const focused = document.activeElement;
  setLocale('ko');
  expect(map.dialog.open).toBe(true);
  expect(document.activeElement).toBe(focused);
  expect(map.canvas.getAttribute('aria-label')).toBe('확대 방 지도 열기');
  expect(map.dialog.textContent).toContain('방 지도');
  expect(document.getElementById('mobile-movement-guidance')).toBe(hint);
  expect(hint?.textContent).toBe('누른 채 드래그하여 이동');
});

it('keeps an open share QR and copied feedback across locale changes', async () => {
  const callbacks: (() => void)[] = [];
  const make = vi.fn();
  const share = mountShare({ document, location: { protocol: 'https:', host: 'museum.test' }, roomId: 'room-id',
    navigator: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
    qrcode: () => ({ addData: vi.fn(), make, createImgTag: () => '<img alt="QR">' }),
    setTimeout: (callback: () => void) => callbacks.push(callback) });
  cleanup.push(share.destroy);
  document.getElementById('share-room-btn')!.click();
  const overlay = document.getElementById('share-qr-overlay');
  const copy = document.getElementById('qr-copy-btn')!;
  copy.click(); await Promise.resolve();
  setLocale('ko');
  expect(document.getElementById('share-qr-overlay')).toBe(overlay);
  expect(make).toHaveBeenCalledTimes(1);
  expect(copy.textContent).toContain('복사 완료');
  expect(overlay?.textContent).toContain('https://museum.test/room?room_id=room-id');
  callbacks[0]();
  expect(copy.textContent).toContain('URL 복사');
});

it('updates pending and active voice controls without requesting or stopping media again', async () => {
  let resolveMedia!: (stream: any) => void;
  const getUserMedia = vi.fn(() => new Promise(resolve => { resolveMedia = resolve; }));
  const stop = vi.fn(), emit = vi.fn(), track = { enabled: true, stop };
  const voice = createVoiceChat({ document, navigator: { mediaDevices: { getUserMedia } },
    fetch: async () => ({ ok: true, json: async () => ({ enabled: false }) }), setTimeout: () => 0,
    RTCPeerConnection: vi.fn(), MediaRecorder: vi.fn(), AudioContext: vi.fn() });
  cleanup.push(voice.destroy);
  voice.init('room', 'visitor', true, { emit });
  voice.handleSocketEvent('voice_admin_toggle', { enabled: true });
  const button = document.getElementById('voice-btn')!;
  button.click();
  setLocale('ko');
  expect(button.textContent).toBe('마이크 연결 중…');
  resolveMedia({ getTracks: () => [track], getAudioTracks: () => [track] });
  await Promise.resolve(); await Promise.resolve();
  expect(button.textContent).toContain('음소거');
  setLocale('en');
  expect(document.getElementById('voice-btn')).toBe(button);
  expect(button.textContent).toContain('Muted');
  expect(document.getElementById('voice-toast')?.textContent).toContain('Voice active');
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  expect(emit.mock.calls.filter(([event]) => event === 'voice.join')).toHaveLength(1);
  expect(track.enabled).toBe(false);
});
