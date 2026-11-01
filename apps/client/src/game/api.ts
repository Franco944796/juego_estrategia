import type {
  ClanDetail,
  ClanRankingRow,
  ClanRole,
  ClanSummary,
  HallResponse,
  MeResponse,
  MyClan,
  PublicAccount,
  SessionResponse,
} from '@si/protocol';

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
  createClan: (token: string, name: string, tag: string) =>
    request<{ value: MyClan }>('/api/clans', { method: 'POST', token, body: { name, tag } }),
  searchClans: (query: string) =>
    request<{ clans: ClanSummary[] }>(`/api/clans?q=${encodeURIComponent(query)}`),
  clan: (token: string, id: string) => request<{ value: ClanDetail }>(`/api/clans/${id}`, { token }),
  clanRanking: () => request<{ ranking: ClanRankingRow[] }>('/api/clans/ranking'),
  requestJoin: (token: string, id: string) => request(`/api/clans/${id}/requests`, { method: 'POST', token }),
  decide: (token: string, id: string, accountId: string, accept: boolean) =>
    request(`/api/clans/${id}/requests/${accountId}/${accept ? 'accept' : 'reject'}`, {
      method: 'POST',
      token,
    }),
  leaveClan: (token: string) => request('/api/clan/leave', { method: 'POST', token }),
  kick: (token: string, accountId: string) =>
    request(`/api/clan/members/${accountId}/kick`, { method: 'POST', token }),
  setRole: (token: string, accountId: string, role: Exclude<ClanRole, 'leader'>) =>
    request(`/api/clan/members/${accountId}/role`, { method: 'POST', token, body: { role } }),
};
