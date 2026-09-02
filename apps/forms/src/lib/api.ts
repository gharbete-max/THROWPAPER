import type { api, forms as formSchemas } from '@tp/shared';
import type { TokenSet, ContrastFinding } from '@tp/tokens';
import type { FormTemplate } from '@tp/shared/forms';

export interface BrandKitResponse {
  tokens: TokenSet;
  /** `false` when nothing has been saved and these are the shipped defaults. */
  customised: boolean;
  updatedAt: string | null;
  /** Advisory. The server stores the kit either way — see routes/brand-kit.ts. */
  warnings: ContrastFinding[];
}

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
  /**
   * A multipart body sets its own content type, including the boundary the browser generated.
   * Overriding it with application/json produces a request the server cannot parse — and the
   * failure looks like a broken upload rather than a wrong header.
   */
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');
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

/**
 * Fetches bytes rather than JSON, with the session attached.
 *
 * `request` parses every response as JSON, which a PDF is not. Kept separate rather than
 * generalised: one caller, and a shared helper that sometimes parses and sometimes does not is
 * how a download ends up silently returning `null`.
 *
 * A 401 refreshes once and retries, the same as `request`, so a long-open submissions screen
 * does not start failing downloads after the access token ages out.
 */
async function requestBlob(path: string, retry = true): Promise<Blob> {
  const headers = new Headers();
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${BASE}${path}`, { headers });
  if (response.status === 401 && retry && (await refreshOnce())) {
    return requestBlob(path, false);
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'download-failed', 'That file could not be downloaded');
  }
  return response.blob();
}

export const client = {
  /** Whether this server is a demo. Drives the banner and the sign-in shortcut. */
  health: () => request<{ status: string; mode: 'demo' | 'live'; database: string }>('/health'),

  demoInfo: () =>
    request<{ demo: true; formSlug: string; users: Array<{ email: string; role: string }> }>(
      '/demo/info',
    ),

  demoSignIn: (email: string) =>
    request<api.TokenPair>('/demo/sign-in', { method: 'POST', body: JSON.stringify({ email }) }),

  demoReset: () => request<{ status: string }>('/demo/reset', { method: 'POST' }),

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

  brandKit: () => request<BrandKitResponse>('/v1/brand-kit'),

  saveBrandKit: (tokens: TokenSet) =>
    request<BrandKitResponse>('/v1/brand-kit', { method: 'PUT', body: JSON.stringify(tokens) }),

  resetBrandKit: () => request<BrandKitResponse>('/v1/brand-kit', { method: 'DELETE' }),

  /**
   * Uploads a file. `body` is FormData, so the browser sets the multipart content type and its
   * boundary itself — setting it by hand produces a body the server cannot parse.
   */
  upload: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return request<{ key: string; path: string; contentType: string; bytes: number }>(
      '/v1/uploads',
      { method: 'POST', body },
    );
  },

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

  listForms: (scope: formSchemas.FormScope = 'active') =>
    request<{ forms: formSchemas.FormResponse[] }>(`/v1/forms?scope=${scope}`),

  trashForm: (id: string) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}/trash`, { method: 'POST' }),

  restoreForm: (id: string) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}/restore`, { method: 'POST' }),

  /** Permanent, and only ever reached from the bin — the server refuses it anywhere else. */
  deleteForm: (id: string) => request<null>(`/v1/forms/${id}`, { method: 'DELETE' }),

  listShares: (id: string) =>
    request<{ shares: formSchemas.FormShareResponse[] }>(`/v1/forms/${id}/shares`),

  shareForm: (id: string, email: string, role: formSchemas.FormShareRole) =>
    request<{ shares: formSchemas.FormShareResponse[] }>(`/v1/forms/${id}/shares`, {
      method: 'PUT',
      body: JSON.stringify({ email, role }),
    }),

  unshareForm: (id: string, userId: string) =>
    request<null>(`/v1/forms/${id}/shares/${userId}`, { method: 'DELETE' }),

  /** Responses arriving across every form you can see. */
  inbox: (limit = 50) =>
    request<{ submissions: formSchemas.InboxEntry[] }>(`/v1/submissions?limit=${limit}`),

  listUsers: () => request<{ users: formSchemas.UserSummary[] }>('/v1/admin/users'),

  /** One colleague's workspace, read as yourself — see `routes/admin.ts` on why not impersonation. */
  userForms: (id: string, scope: formSchemas.FormScope = 'active') =>
    request<{ forms: formSchemas.FormResponse[] }>(`/v1/admin/users/${id}/forms?scope=${scope}`),

  getForm: (id: string) => request<formSchemas.FormResponse>(`/v1/forms/${id}`),

  formTemplates: () => request<{ templates: FormTemplate[] }>('/v1/form-templates'),

  createForm: (input: {
    slug: string;
    title: Record<string, string>;
    eventId?: string | null;
    templateId?: string;
  }) =>
    request<formSchemas.FormResponse>('/v1/forms', { method: 'POST', body: JSON.stringify(input) }),

  updateForm: (id: string, patch: Record<string, unknown>) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  saveDraft: (id: string, definition: formSchemas.FormDefinition) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ definition }),
    }),

  publishForm: (id: string, overrideIncompleteTranslations = false) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ overrideIncompleteTranslations }),
    }),

  listFormVersions: (id: string) =>
    request<{ versions: formSchemas.FormVersionSummary[] }>(`/v1/forms/${id}/versions`),

  checkIn: (eventId: string, code: string) =>
    request<{
      outcome: 'admitted' | 'already' | 'revoked' | 'wrong-event' | 'not-found' | 'bad-signature';
      attendee: {
        submissionId: string;
        reference: string;
        name: string;
        email: string | null;
        revoked: boolean;
        checkedInAt: string | null;
      } | null;
      checkedInAt: string | null;
    }>(`/v1/events/${eventId}/check-ins`, { method: 'POST', body: JSON.stringify({ code }) }),

  attendance: (eventId: string) =>
    request<{
      registered: number;
      checkedIn: number;
      noShow: number;
      revoked: number;
      byHour: Array<{ hour: string; count: number }>;
      attendees: Array<{
        submissionId: string;
        reference: string;
        name: string;
        email: string | null;
        locale: string;
        revoked: boolean;
        checkedInAt: string | null;
      }>;
    }>(`/v1/events/${eventId}/attendance`),

  revokeSubmission: (submissionId: string) =>
    request<{ submissionId: string; revoked: boolean }>(`/v1/submissions/${submissionId}/revoke`, {
      method: 'POST',
    }),

  /** One file from one submission. Authenticated, and scoped to that submission by the server. */
  submissionFile: (submissionId: string, key: string) =>
    requestBlob(`/v1/submissions/${submissionId}/files/${key}`),

  listSubmissions: (id: string) =>
    request<{
      submissions: formSchemas.SubmissionResponse[];
      definition: formSchemas.FormDefinition;
    }>(`/v1/forms/${id}/submissions`),

  restoreFormVersion: (id: string, version: number) =>
    request<formSchemas.FormResponse>(`/v1/forms/${id}/versions/${version}/restore`, {
      method: 'POST',
    }),
};

/** Restores a session from the stored refresh token on a cold load. */
export async function restoreSession(): Promise<api.MeResponse | null> {
  if (!storedRefreshToken()) return null;
  if (!(await refreshOnce())) return null;
  return client.me().catch(() => null);
}
