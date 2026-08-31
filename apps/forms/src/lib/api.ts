import type { api } from '@tp/shared';

/**
 * Typed client for the Formwork API.
 *
 * Bearer tokens in memory, refresh token in localStorage: a token in localStorage is readable by
 * any script on the page, so the short-lived one never goes there. Rule 3 — every screen calls a
 * documented endpoint, and nothing here depends on cookies.
 */
const BASE = '/api';
const REFRESH_KEY = 'tp.refresh';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  } catch {
    // Private browsing with storage disabled: the session simply ends with the tab.
  }
}

export function clearSession(): void {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function storedRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Refreshes at most once per burst of 401s, so a page of parallel requests rotates one token. */
async function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = storedRefreshToken();
    if (!refreshToken) return false;
    const response = await fetch(`${BASE}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      clearSession();
      return false;
    }
    setSession((await response.json()) as { accessToken: string; refreshToken: string });
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  if (response.status === 401 && retry && (await refreshOnce())) {
    return request<T>(path, init, false);
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? `Request failed with ${response.status}`,
    );
  }
  return body as T;
}

export const client = {
  requestMagicLink: (email: string) =>
    request<{ status: string }>('/v1/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  exchange: (token: string) =>
    request<api.TokenPair>('/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  me: () => request<api.MeResponse>('/v1/me'),

  logout: async () => {
    const refreshToken = storedRefreshToken();
    if (refreshToken) {
      await request<void>('/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
  },

  listEvents: () => request<{ events: api.EventResponse[] }>('/v1/events'),

  createEvent: (input: api.EventInput) =>
    request<api.EventResponse>('/v1/events', { method: 'POST', body: JSON.stringify(input) }),

  updateEvent: (id: string, patch: api.EventPatch) =>
    request<api.EventResponse>(`/v1/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  archiveEvent: (id: string) =>
    request<api.EventResponse>(`/v1/events/${id}/archive`, { method: 'POST' }),
};

/** Restores a session from the stored refresh token on a cold load. */
export async function restoreSession(): Promise<api.MeResponse | null> {
  if (!storedRefreshToken()) return null;
  if (!(await refreshOnce())) return null;
  return client.me().catch(() => null);
}
