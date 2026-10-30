import { describe, it, expect } from 'vitest';
import fixture from '../../public/avatars/catalog.fixture.json';
import { normalizeAppearance } from '../../src/avatar/appearance';
import type { AvatarCatalog } from '../../src/avatar/types';
import { createElement } from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { AvatarEditor } from '../../src/features/avatar/AvatarEditor';
const catalog = fixture as unknown as AvatarCatalog;
describe('appearance normalization', () => {
  it('migrates the three legacy fields without importing caller URLs', () => {
    const look = normalizeAppearance({ avatarId: 'robot', color: '#123abc', assetUrl: 'https://bad.invalid' }, catalog);
    expect(look.presetId).toBe('robot');
    expect(look.colors.top).toBe('#123ABC');
    expect(Object.keys(look).sort()).toEqual(['schemaVersion','presetId','colors','faceId','hairId','hatId','glassesId'].sort());
  });
  it('falls back safely and hides hair under a cap without mutating the catalog', () => {
    const look = normalizeAppearance({ presetId: 'casual', colors: { top: 'red' }, faceId: 'unknown', hairId: 'short', hatId: 'cap' }, catalog);
    expect(look.colors.top).toBe(catalog.presets[0].defaultAppearance!.colors.top);
    expect(look.faceId).toBe('friendly');
    expect(look.hairId).toBe('none');
    expect(catalog.presets[0].defaultAppearance!.hairId).toBe('short');
  });
});

it('keeps the editor pending until Apply resolves and Cancel never applies a draft', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const initial = normalizeAppearance({ avatarId: 'robot', color: '#123456' }, catalog);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const applied: unknown[] = [], closed: boolean[] = [];
  const view = render(createElement(AvatarEditor, { catalog, initial,
    onApply: async look => { applied.push(look); await pending; },
    onReload: async () => initial, onClose: () => { closed.push(true); } }));
  fireEvent.change(screen.getByLabelText('top color'), { target: { value: '#abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(applied).toHaveLength(0);
  expect(closed).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(closed).toHaveLength(1);
  finish();
  await waitFor(() => expect(closed).toHaveLength(2));
  expect((applied[0] as any).colors.top).toBe('#ABCDEF');
  view.unmount();
});
