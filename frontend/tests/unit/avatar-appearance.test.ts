import { describe, it, expect } from 'vitest';
import fixture from '../../public/avatars/catalog.fixture.json';
import { normalizeAppearance, resolveSavedProfile } from '../../src/avatar/appearance';
import type { AvatarCatalog } from '../../src/avatar/types';
import { createElement } from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { AvatarEditor } from '../../src/features/avatar/AvatarEditor';
const catalog = fixture as unknown as AvatarCatalog;

it('restores an unsaved anonymous legacy look after logout instead of carrying the account look', () => {
  sessionStorage.clear();
  const original = { displayName: 'Tab Visitor', avatarId: 'robot', color: '#123456' };
  const anonymous = { appearance: null, ownerScopeToken: 'anonymous-scope' };
  const first = resolveSavedProfile(original, anonymous, sessionStorage, catalog);
  const account = resolveSavedProfile(first, { appearance: normalizeAppearance({ presetId: 'casual' }, catalog), ownerScopeToken: 'account-a' }, sessionStorage, catalog);
  const restored = resolveSavedProfile({ ...account, displayName: 'Renamed Tab' }, anonymous, sessionStorage, catalog);
  expect(restored).toMatchObject({ displayName: 'Renamed Tab', avatarId: 'robot', color: '#123456' });
  expect(JSON.stringify(restored)).not.toContain('scope');
  expect(sessionStorage.getItem('metamuseum.tab-visitor.v1')).toBeNull();
});

it('uses a safe default for a new empty owner and for old account-shaped tab data without owner metadata', () => {
  sessionStorage.clear();
  const accountLook = normalizeAppearance({ presetId: 'explorer' }, catalog);
  const account = resolveSavedProfile({ displayName: 'Tab Visitor', avatarId: 'robot', color: '#123456' }, { appearance: accountLook, ownerScopeToken: 'account-a' }, sessionStorage, catalog);
  const other = resolveSavedProfile(account, { appearance: null, ownerScopeToken: 'account-b' }, sessionStorage, catalog);
  expect(other).toMatchObject({ displayName: 'Tab Visitor', avatarId: 'shiba', color: '#4CAF50' });
  sessionStorage.clear();
  const migrated = resolveSavedProfile(account, { appearance: null, ownerScopeToken: 'anonymous' }, sessionStorage, catalog);
  expect(migrated.avatarId).toBe('shiba');
});
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
  fireEvent.change(screen.getByLabelText('상의 색상'), { target: { value: '#abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(applied).toHaveLength(0);
  expect(closed).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '적용' }));
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  expect(closed).toHaveLength(1);
  finish();
  await waitFor(() => expect(closed).toHaveLength(2));
  expect((applied[0] as any).colors.top).toBe('#ABCDEF');
  view.unmount();
});
