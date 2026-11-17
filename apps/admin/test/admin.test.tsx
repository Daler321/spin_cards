import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { allowed } from '../src/sections';

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(data), { status }));

describe('admin app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('shows sections by role', () => {
    expect(allowed('owner', 'audit')).toBe(true);
    expect(allowed('support', 'audit')).toBe(false);
    expect(allowed('support', 'users')).toBe(true);
    expect(allowed('analyst', 'users')).toBe(false);
    expect(allowed('analyst', 'pool')).toBe(true);
  });

  it('signs in with password, then the TOTP code, sending the CSRF header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init && { init }) });
      const body = init?.body ? (JSON.parse(init.body as string) as { totp?: string }) : {};
      if (url.endsWith('/auth/me')) return json({ error: { code: 'UNAUTHORIZED' } }, 401);
      if (url.endsWith('/auth/login'))
        return json(
          body.totp
            ? { stage: 'done', admin: { id: 'a', login: 'boss', role: 'support' } }
            : { stage: 'totp_required' },
        );
      if (url.includes('/users')) return json([]);
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'boss' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.change(await screen.findByLabelText(/Код из приложения/), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    // Support sees players, not the audit log.
    expect(await screen.findByRole('heading', { name: 'Игроки' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Журнал' })).toBeNull();
    const loginCall = calls.filter((c) => c.url.endsWith('/auth/login')).at(-1);
    expect(loginCall?.init?.headers).toMatchObject({ 'x-admin-request': '1' });
    expect(JSON.parse(loginCall?.init?.body as string)).toEqual({
      login: 'boss',
      password: 'secret',
      totp: '123456',
    });
  });
});
