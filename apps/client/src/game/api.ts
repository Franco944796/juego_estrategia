import type { HallResponse, MeResponse, PublicAccount, SessionResponse } from '@si/protocol';

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function request<T>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('NETWORK');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? 'NETWORK');
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  session: (name: string) => request<SessionResponse>('/api/session', { method: 'POST', body: { name } }),
  me: (token: string) => request<MeResponse>('/api/me', { token }),
  join: (token: string) => request<{ ok: boolean }>('/api/join', { method: 'POST', token }),
  unlock: (token: string, style: string) =>
    request<{ account: PublicAccount }>('/api/styles/unlock', { method: 'POST', token, body: { style } }),
  equip: (token: string, style: string) =>
    request<{ account: PublicAccount }>('/api/styles/equip', { method: 'POST', token, body: { style } }),
  hall: () => request<HallResponse>('/api/hall'),
};
