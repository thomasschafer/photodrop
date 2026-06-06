import { Capacitor } from '@capacitor/core';
import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';
import type { ProfileColor } from './profileColors';
import type { MembershipRole } from './roles';

// Check if we're in a Capacitor native environment
const isNative = Capacitor.isNativePlatform();

export interface User {
  id: string;
  name: string;
  email: string;
  profileColor: ProfileColor;
}

export interface Group {
  id: string;
  name: string;
  role: MembershipRole;
  ownerId: string;
  imageProtection: boolean;
}

export interface AuthResponse {
  accessToken: string | null;
  selectionToken?: string;
  user: User;
  currentGroup?: Group | null;
  groups: Group[];
  needsGroupSelection?: boolean;
}

interface VerifyMagicLinkNeedsName {
  needsName: true;
  email: string;
  groupId: string;
}

export type VerifyMagicLinkResponse = AuthResponse | VerifyMagicLinkNeedsName;

interface GetMeResponse extends User {
  currentGroup: Group | null;
  groups: Group[];
}

function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    return envUrl;
  }

  const hostname = window.location.hostname;

  // Local development or Capacitor native
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    if (isNative) {
      return 'http://localhost:8787';
    }
    return '/api';
  }

  // Production web fallback. For apex domains use api.example.com; for app
  // subdomains use app-api.example.com to stay within Cloudflare Universal SSL.
  const parts = hostname.split('.');
  if (parts.length > 2) {
    const [subdomain, ...rootParts] = parts;
    return `https://${subdomain}-api.${rootParts.join('.')}`;
  }
  return `https://api.${hostname}`;
}

export const API_BASE_URL = getApiBaseUrl();

class ApiError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

// Wrapper to normalize Capacitor HTTP response to look like fetch Response
class NativeResponse {
  status: number;
  statusText: string;
  ok: boolean;
  private data: unknown;

  constructor(response: HttpResponse) {
    this.status = response.status;
    this.statusText = response.status >= 200 && response.status < 300 ? 'OK' : 'Error';
    this.ok = response.status >= 200 && response.status < 300;
    this.data = response.data;
  }

  async json() {
    return this.data;
  }
}

function buildHeaders(options: RequestInit, includeAuth: boolean): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    Object.assign(headers, existingHeaders);
  }

  if (includeAuth) {
    const token = localStorage.getItem('accessToken');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // CSRF protection header
  headers['X-Requested-With'] = 'XMLHttpRequest';

  return headers;
}

// Execute a single request without 401-refresh handling. Returns the response
// as-is (including error statuses) so callers can inspect the status code.
async function executeRequest(
  url: string,
  options: RequestInit,
  includeAuth: boolean
): Promise<Response | NativeResponse> {
  const headers = buildHeaders(options, includeAuth);

  // Use native HTTP for Capacitor, regular fetch for web
  // EXCEPT for FormData uploads - use regular fetch for those (CapacitorHttp handles it via plugin)
  if (isNative && !(options.body instanceof FormData)) {
    const httpOptions: HttpOptions = {
      url: `${API_BASE_URL}${url}`,
      headers,
      webFetchExtra: { credentials: 'include' },
    };

    // Handle method and body
    const method = (options.method || 'GET').toUpperCase();
    if (options.body && typeof options.body === 'string') {
      httpOptions.data = JSON.parse(options.body);
    }

    let response: HttpResponse;
    switch (method) {
      case 'POST':
        response = await CapacitorHttp.post(httpOptions);
        break;
      case 'PUT':
        response = await CapacitorHttp.put(httpOptions);
        break;
      case 'DELETE':
        response = await CapacitorHttp.delete(httpOptions);
        break;
      case 'PATCH':
        response = await CapacitorHttp.patch(httpOptions);
        break;
      default:
        response = await CapacitorHttp.get(httpOptions);
    }

    return new NativeResponse(response);
  }

  // Regular fetch for web
  return fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });
}

// Single-flight session refresh: every refresh — the 401-retry path below and
// the bootstrap/interval/foreground refreshes in AuthContext (via
// api.auth.refresh) — shares one in-flight POST /auth/refresh, so the refresh
// cookie is never rotated by concurrent calls. Throws on failure, like a normal
// request.
let refreshPromise: Promise<AuthResponse> | null = null;

function refreshSession(): Promise<AuthResponse> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // includeAuth=false so this call never recurses into refresh-on-401.
      const response = await executeRequest('/auth/refresh', { method: 'POST' }, false);
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(
          response.status,
          response.statusText,
          errorData?.error || 'Failed to refresh session'
        );
      }
      return (await response.json()) as AuthResponse;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// A refresh failure means the session is genuinely gone only when the server
// explicitly rejects the refresh cookie (401/403). Network errors and 5xxs are
// transient and tell us nothing about the session, so they must not force a
// logout. Shared by the 401-retry path here and AuthContext's interval/
// foreground refresh so both apply the same rule.
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

// 401-retry outcome: refresh, then route. A fresh token or a still-valid
// session that needs group selection both dispatch auth:token-refreshed
// (AuthContext syncs state / shows the picker); a genuinely dead session
// dispatches auth:session-expired. Resolves to true when there's a fresh token
// to retry the original request with. Exported so the authenticated-image
// fetch (which can't use fetchWithAuth) can recover from a 401 the same way.
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const data = await refreshSession();
    if (data.accessToken) {
      localStorage.setItem('accessToken', data.accessToken);
      window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: data }));
      return true;
    }
    // Valid session but no active group (e.g. removed from the current/last
    // group): hand the response to the app so it can show the group picker or
    // the no-groups state, rather than logging out. The refresh endpoint only
    // returns a user when the refresh cookie verified, so a user with no token
    // always means a live session — regardless of how many groups remain.
    // There's no token, so the original request can't be retried.
    if (data.user) {
      localStorage.removeItem('accessToken');
      window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: data }));
      return false;
    }
    // A 2xx response with neither a token nor a user means the session is gone;
    // fall through to the teardown below.
  } catch (error) {
    // Transient failure: keep the session intact and let the caller's request
    // fail. The next interval/foreground refresh can recover.
    if (!isSessionExpired(error)) {
      return false;
    }
    // A genuine expiry falls through to the teardown below.
  }
  localStorage.removeItem('accessToken');
  window.dispatchEvent(new CustomEvent('auth:session-expired'));
  return false;
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  includeAuth: boolean = true,
  isRetry: boolean = false
): Promise<Response | NativeResponse> {
  const response = await executeRequest(url, options, includeAuth);

  // The access token has likely expired. Refresh once via the httpOnly refresh
  // cookie and retry. Only for authenticated requests — /auth/* calls pass
  // includeAuth=false, so they never trigger (and can't recurse).
  if (response.status === 401 && includeAuth && !isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return fetchWithAuth(url, options, includeAuth, true);
    }
    // No fresh token: refreshAccessToken has already handled the outcome
    // (routed to group selection, or signalled session expiry). Fall through
    // to surface the original error to the caller.
  }

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      response.status,
      response.statusText,
      errorData?.error || 'An error occurred'
    );
  }

  return response;
}

export const api = {
  auth: {
    sendLoginLink: async (email: string) => {
      const response = await fetchWithAuth(
        '/auth/send-login-link',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
        false
      );
      return response.json();
    },

    sendInvite: async (email: string, role: 'admin' | 'member' = 'member') => {
      const response = await fetchWithAuth('/auth/send-invite', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      return response.json();
    },

    verifyMagicLink: async (token: string, name?: string): Promise<VerifyMagicLinkResponse> => {
      const response = await fetchWithAuth(
        '/auth/verify-magic-link',
        {
          method: 'POST',
          body: JSON.stringify({ token, name }),
        },
        false
      );
      return response.json();
    },

    // Shares the single-flight refresh with the 401-retry path so concurrent
    // refreshes never rotate the cookie twice.
    refresh: (): Promise<AuthResponse> => refreshSession(),

    logout: async () => {
      const response = await fetchWithAuth('/auth/logout', {
        method: 'POST',
      });
      return response.json();
    },

    switchGroup: async (groupId: string): Promise<AuthResponse> => {
      const response = await fetchWithAuth('/auth/switch-group', {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      });
      return response.json();
    },

    selectGroup: async (selectionToken: string, groupId: string): Promise<AuthResponse> => {
      const response = await fetchWithAuth(
        '/auth/select-group',
        {
          method: 'POST',
          body: JSON.stringify({ selectionToken, groupId }),
        },
        false
      );
      return response.json();
    },
  },

  groups: {
    list: async () => {
      const response = await fetchWithAuth('/groups');
      return response.json();
    },

    getMembers: async (groupId: string) => {
      const response = await fetchWithAuth(`/groups/${groupId}/members`);
      return response.json();
    },

    updateMemberRole: async (groupId: string, userId: string, role: 'admin' | 'member') => {
      const response = await fetchWithAuth(`/groups/${groupId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      return response.json();
    },

    updateMemberName: async (groupId: string, userId: string, name: string) => {
      const response = await fetchWithAuth(`/groups/${groupId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      return response.json();
    },

    removeMember: async (groupId: string, userId: string) => {
      const response = await fetchWithAuth(`/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    deleteGroup: async (groupId: string) => {
      const response = await fetchWithAuth(`/groups/${groupId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    getPhotoCount: async (groupId: string): Promise<{ count: number }> => {
      const response = await fetchWithAuth(`/groups/${groupId}/photo-count`);
      return response.json();
    },

    updateMemberImageProtection: async (groupId: string, userId: string, enabled: boolean) => {
      const response = await fetchWithAuth(
        `/groups/${groupId}/members/${userId}/image-protection`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }
      );
      return response.json();
    },
  },

  users: {
    getMe: async (): Promise<GetMeResponse> => {
      const response = await fetchWithAuth('/users/me');
      return response.json();
    },

    getAll: async () => {
      const response = await fetchWithAuth('/users');
      return response.json();
    },

    updateProfile: async (profileColor: ProfileColor) => {
      const response = await fetchWithAuth('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profileColor }),
      });
      return response.json();
    },
  },

  photos: {
    list: async (limit: number = 20, offset: number = 0) => {
      const response = await fetchWithAuth(`/photos?limit=${limit}&offset=${offset}`);
      return response.json();
    },

    upload: async (photo: File, thumbnail: File, caption?: string) => {
      const formData = new FormData();
      formData.append('photo', photo);
      formData.append('thumbnail', thumbnail);
      if (caption) {
        formData.append('caption', caption);
      }

      const response = await fetchWithAuth('/photos', {
        method: 'POST',
        body: formData,
      });
      return response.json();
    },

    get: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}`);
      return response.json();
    },

    getUrl: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/url`);
      return response.json();
    },

    getThumbnailUrl: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/thumbnail-url`);
      return response.json();
    },

    delete: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    recordView: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/view`, {
        method: 'POST',
      });
      return response.json();
    },

    getViewers: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/viewers`);
      return response.json();
    },

    addReaction: async (photoId: string, emoji: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      return response.json();
    },

    removeReaction: async (photoId: string, emoji: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/react`, {
        method: 'DELETE',
        body: JSON.stringify({ emoji }),
      });
      return response.json();
    },

    getReactions: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/reactions`);
      return response.json();
    },

    getComments: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/comments`);
      return response.json();
    },

    addComment: async (photoId: string, content: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      return response.json();
    },

    deleteComment: async (photoId: string, commentId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/comments/${commentId}`, {
        method: 'DELETE',
      });
      return response.json();
    },
  },

  push: {
    getVapidPublicKey: async (): Promise<{ publicKey: string }> => {
      const response = await fetchWithAuth('/push/vapid-public-key', {}, false);
      return response.json();
    },

    subscribe: async (subscription: PushSubscriptionJSON) => {
      const response = await fetchWithAuth('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
      });
      const data = await response.json();
      if (data.deletionToken && subscription.endpoint) {
        localStorage.setItem(`push_deletion_token:${subscription.endpoint}`, data.deletionToken);
      }
      return data;
    },

    unsubscribeFromCurrentGroup: async (endpoint: string) => {
      const response = await fetchWithAuth('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      });
      return response.json();
    },

    getStatus: async (endpoint: string): Promise<{ subscribed: boolean }> => {
      const response = await fetchWithAuth(`/push/status?endpoint=${encodeURIComponent(endpoint)}`);
      return response.json();
    },

    unsubscribe: async (endpoint: string) => {
      const deletionToken = localStorage.getItem(`push_deletion_token:${endpoint}`);
      if (!deletionToken) {
        console.warn('No deletion token found for endpoint, skipping unsubscribe');
        return;
      }
      await fetch(`${API_BASE_URL}/push/unsubscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ endpoint, deletionToken }),
      });
      localStorage.removeItem(`push_deletion_token:${endpoint}`);
    },

    // Native push (FCM) device token methods
    registerDevice: async (platform: 'ios' | 'android', token: string) => {
      const response = await fetchWithAuth('/push/device', {
        method: 'POST',
        body: JSON.stringify({ platform, token }),
      });
      return response.json();
    },

    unregisterDevice: async (token: string) => {
      const response = await fetchWithAuth('/push/device', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      });
      return response.json();
    },

    getDeviceStatus: async (token: string): Promise<{ registered: boolean }> => {
      const response = await fetchWithAuth(
        `/push/device/status?token=${encodeURIComponent(token)}`
      );
      return response.json();
    },

    sendTestNotification: async (
      token: string
    ): Promise<{ success?: boolean; error?: string; message?: string; debug?: unknown }> => {
      try {
        const response = await fetchWithAuth('/push/test', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        return response.json();
      } catch (error) {
        // Return error info instead of throwing
        if (error instanceof ApiError) {
          return {
            success: false,
            error: error.message,
            debug: { status: error.status, statusText: error.statusText },
          };
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
};

export { ApiError };
