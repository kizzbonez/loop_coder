import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, onUnauthorized } from './api';

function mockFetch(status: number, body?: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('api client', () => {
  it('sends the CSRF header, same-origin credentials and JSON', async () => {
    const spy = mockFetch(200, { ok: true });
    await api.post('/things', { a: 1 });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/things');
    expect(init?.credentials).toBe('same-origin');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('returns undefined for 204 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete('/x')).resolves.toBeUndefined();
  });

  it('turns error bodies into ApiError with field errors', async () => {
    mockFetch(400, { error: { code: 'bad_request', message: 'Validation failed', details: [{ path: 'email', message: 'Invalid email' }] } });
    const err = await api.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).fieldErrors()).toEqual({ email: 'Invalid email' });
    expect(errorMessage(err)).toBe('Validation failed');
  });

  it('notifies listeners when the session has expired', async () => {
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    mockFetch(401, { error: { code: 'unauthorized', message: 'Authentication required' } });
    await api.get('/workspaces').catch(() => undefined);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it('does not treat a failed login as an expired session', async () => {
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    mockFetch(401, { error: { code: 'unauthorized', message: 'Invalid email or password' } });
    await api.post('/auth/login', {}).catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('survives non-JSON error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/502/);
  });
});
