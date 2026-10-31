import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fixture from '../../public/avatars/catalog.fixture.json';
import type { AvatarCatalog } from '../../src/avatar/types';
import { normalizeAppearance } from '../../src/avatar/appearance';
import { setLocale } from '../../src/app/i18n';
import { AvatarEditor } from '../../src/features/avatar/AvatarEditor';
import { mountAvatarXRPanel } from '../../src/features/avatar/xr-panel';

const catalog = fixture as unknown as AvatarCatalog;
const showModal = HTMLDialogElement.prototype.showModal;
beforeEach(() => {
  setLocale('ko');
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
});
afterEach(() => {
  cleanup();
  setLocale('ko');
  HTMLDialogElement.prototype.showModal = showModal;
  vi.restoreAllMocks();
});

it('keeps edited appearance and catalog IDs when its language switch changes labels', async () => {
  const initial = normalizeAppearance({ presetId: 'casual' }, catalog);
  const apply = vi.fn().mockResolvedValue(undefined);
  render(<AvatarEditor catalog={catalog} initial={initial} onApply={apply}
    onReload={async () => initial} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('상의 색상'), { target: { value: '#123456' } });
  fireEvent.change(screen.getByLabelText('표정'), { target: { value: 'calm' } });
  fireEvent.change(screen.getByLabelText('언어 / Language'), { target: { value: 'en' } });
  expect(screen.getByRole('dialog', { name: 'My avatar' })).toBeInTheDocument();
  expect(screen.getByLabelText('Top color')).toHaveValue('#123456');
  expect(screen.getByLabelText('Face')).toHaveValue('calm');
  expect(screen.getByLabelText('Avatar preset')).toHaveValue('casual');
  expect(screen.getByRole('option', { name: 'Casual' })).toHaveValue('casual');
  expect(screen.getByRole('status')).toHaveTextContent('Preview runtime unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await act(async () => {});
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({
    presetId: 'casual', faceId: 'calm', colors: expect.objectContaining({ top: '#123456' }),
  }));
  expect(catalog.presets[0].label).toBe('Casual');
});

it('updates existing native XR labels and stops updating them after disposal', () => {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect() {}, measureText: () => ({ width: 100 }), fillText: draw,
  } as unknown as CanvasRenderingContext2D);
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: ElementCreationOptions) => {
    const element: any = create(name, options);
    if (name.startsWith('a-')) { element.play = vi.fn(); element.pause = vi.fn(); }
    return element;
  }) as typeof document.createElement);
  const scene = document.createElement('div');
  document.body.append(scene);
  const dispose = mountAvatarXRPanel({ scene, catalog,
    current: () => normalizeAppearance({ presetId: 'casual' }, catalog), apply: async () => {} });
  const panel = scene.querySelector('#avatar-xr-panel')!;
  const labels = () => [...panel.querySelectorAll('[data-avatar-xr-label]')].map(text => text.getAttribute('aria-label'));
  expect(labels()).toContain('적용');
  act(() => setLocale('en'));
  expect(scene.querySelector('#avatar-xr-panel')).toBe(panel);
  expect(labels()).toContain('Apply');
  expect(labels()).toContain('My avatar - select, Apply or Revert');
  expect(draw).toHaveBeenCalledWith('적용', 512, 128);
  expect(draw).toHaveBeenCalledWith('Apply', 512, 128);
  const texture = { dispose: vi.fn() };
  (panel.querySelector('[data-avatar-xr-label]') as any).getObject3D = () => ({ material: { map: texture } });
  dispose();
  expect(texture.dispose).toHaveBeenCalledTimes(1);
  act(() => setLocale('ko'));
  expect(labels()).toContain('Apply');
  expect(scene.querySelector('#avatar-xr-panel')).toBeNull();
  expect(scene.querySelector('canvas')).toBeNull();
  scene.remove();
});
