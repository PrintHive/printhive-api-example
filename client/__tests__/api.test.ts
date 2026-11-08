import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('renews a stale backend session and retries a saved order read once', async () => {
  vi.resetModules();
  const { api } = await import('../lib/api');
  let token = 'old', sessions = 0;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path === '/session') { sessions++; return Response.json({ token }); }
    const supplied = new Headers(options?.headers).get('x-printhive-session');
    calls.push(supplied ?? '');
    return supplied === token ? Response.json({ held: true }) : Response.json({ code: 'invalid_session' }, { status: 403 });
  }));
  const schema = z.object({ held: z.boolean() });
  await api('/orders/saved', schema);
  token = 'new';
  expect(await api('/orders/saved', schema)).toEqual({ held: true });
  expect(calls).toEqual(['old', 'old', 'new']); expect(sessions).toBe(2);
});
it('retries session 403 at most once and does not retry unrelated 403 responses', async () => {
  vi.resetModules();
  const { api } = await import('../lib/api');
  let calls = 0, code = 'invalid_session';
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/session') return Response.json({ token: 'fresh' });
    calls++; return Response.json({ code }, { status: 403 });
  }));
  await expect(api('/orders/saved', z.unknown())).rejects.toThrow('HTTP 403');
  expect(calls).toBe(2); code = 'forbidden';
  await expect(api('/orders/saved', z.unknown())).rejects.toThrow('HTTP 403');
  expect(calls).toBe(3);
});
