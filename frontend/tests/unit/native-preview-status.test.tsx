import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import NativeGaussianPreview from '../../src/features/avatar/NativeGaussianPreview';
import { setLocale } from '../../src/app/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const preview = () => render(<NativeGaussianPreview gaze={{ current: null }} appliedState={{ current: null }}
  summary={null} targetLabel="—" targetColor="#000" />);

it('ends loading and explains unavailable models without starting the renderer', async () => {
  setLocale('en');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: false, scope: 'unavailable', reason: 'disabled' }))));
  preview();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('not available on this server'));
  expect(screen.queryByText('Loading local GaussianAvatars model…')).toBeNull();
  expect(screen.getByLabelText('Native jaw')).toBeDisabled();
});

it('requests server authentication and rechecks model availability after unlocking', async () => {
  setLocale('en');
  const fetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/csrf')) return new Response(JSON.stringify({ csrf_token: 'fixture-csrf' }));
    if (url.endsWith('/unlock')) return new Response(JSON.stringify({ unlocked: true }));
    const unlocked = fetcher.mock.calls.some(([path, opts]) => path.endsWith('/unlock') && opts?.method === 'POST');
    return new Response(JSON.stringify(unlocked ? { ready: false, scope: 'unavailable' } : { ready: false, scope: 'password_required' }));
  });
  vi.stubGlobal('fetch', fetcher);
  preview();
  const pin = await screen.findByLabelText('Temporary password');
  fireEvent.change(pin, { target: { value: '1234' } });
  await act(async () => { fireEvent.submit(pin.closest('form')!); });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('not available on this server'));
  const [, init] = fetcher.mock.calls.find(([path]) => path.endsWith('/unlock'))!;
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ pin: '1234' });
  expect(init.headers.get('X-CSRF-Token')).toBe('fixture-csrf');
  expect(screen.queryByLabelText('Temporary password')).toBeNull();
});
