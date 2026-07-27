import { Capacitor } from '@capacitor/core';
import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';
import type {
  AuthResponse,
  NeedsNameResponse,
  InviteSentResponse,
  MeResponse,
  MessageResponse,
  MembershipRole,
  UserJson,
  GroupJson,
  PhotoListResponse,
  PhotoDetailResponse,
  PhotoUploadResponse,
  PhotoViewersResponse,
  ReactionMutationResponse,
  ReactionsResponse,
  CommentsResponse,
  CommentCreatedResponse,
  GroupsListResponse,
  MembersResponse,
  PhotoCountResponse,
  GroupDeletedResponse,
  UsersListResponse,
  ProfileUpdatedResponse,
  VapidPublicKeyResponse,
  PushSubscribedResponse,
  PushStatusResponse,
  DeviceStatusResponse,
} from '@photodrop/common/apiTypes';
import type { ProfileColor } from './profileColors';
import { setLocalStorageItem } from './storage';

// Check if we're in a Capacitor native environment
const isNative = Capacitor.isNativePlatform();

export type User = UserJson;
export type Group = GroupJson;
export type { AuthResponse };

export type VerifyMagicLinkResponse = AuthResponse | NeedsNameResponse;

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

// Session generation counter. AuthContext's resetToLoggedOut bumps it so that
// a refresh already in flight when the user signs out cannot resurrect the
// session: every refresh path captures the epoch before awaiting and discards
// the result — no localStorage write, no event, no state application — if it
// changed while the request was in the air.
let sessionEpoch = 0;

export function getSessionEpoch(): number {
  return sessionEpoch;
}

export function bumpSessionEpoch(): void {
  sessionEpoch += 1;
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
  const epoch = sessionEpoch;
  try {
    const data = await refreshSession();
    // The user signed out while this refresh was in flight: applying the
    // result would silently sign them back in with a fresh token. Discard it.
    if (epoch !== sessionEpoch) {
      return false;
    }
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
    // As above: the session this refresh belonged to is already torn down, so
    // neither the transient-failure path nor the expiry teardown applies.
    if (epoch !== sessionEpoch) {
      return false;
    }
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

// The single typed exit point of the client: perform a request and parse the
// JSON body as the endpoint's declared response type. The cast is the trust
// boundary with the server; the shapes themselves live in
// @photodrop/common/apiTypes, which the backend compiles against.
async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  includeAuth: boolean = true
): Promise<T> {
  const response = await fetchWithAuth(url, options, includeAuth);
  return (await response.json()) as T;
}

export const api = {
  auth: {
    sendLoginLink: (email: string): Promise<MessageResponse> =>
      requestJson(
        '/auth/send-login-link',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
        false
      ),

    sendInvite: (email: string, role: MembershipRole = 'member'): Promise<InviteSentResponse> =>
      requestJson('/auth/send-invite', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),

    verifyMagicLink: (token: string, name?: string): Promise<VerifyMagicLinkResponse> =>
      requestJson(
        '/auth/verify-magic-link',
        {
          method: 'POST',
          body: JSON.stringify({ token, name }),
        },
        false
      ),

    // Shares the single-flight refresh with the 401-retry path so concurrent
    // refreshes never rotate the cookie twice.
    refresh: (): Promise<AuthResponse> => refreshSession(),

    logout: (): Promise<MessageResponse> =>
      requestJson('/auth/logout', {
        method: 'POST',
      }),

    switchGroup: (groupId: string): Promise<AuthResponse> =>
      requestJson('/auth/switch-group', {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      }),

    selectGroup: (selectionToken: string, groupId: string): Promise<AuthResponse> =>
      requestJson(
        '/auth/select-group',
        {
          method: 'POST',
          body: JSON.stringify({ selectionToken, groupId }),
        },
        false
      ),
  },

  groups: {
    list: (): Promise<GroupsListResponse> => requestJson('/groups'),

    getMembers: (groupId: string): Promise<MembersResponse> =>
      requestJson(`/groups/${groupId}/members`),

    updateMemberRole: (
      groupId: string,
      userId: string,
      role: MembershipRole
    ): Promise<MessageResponse> =>
      requestJson(`/groups/${groupId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),

    updateMemberName: (groupId: string, userId: string, name: string): Promise<MessageResponse> =>
      requestJson(`/groups/${groupId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),

    removeMember: (groupId: string, userId: string): Promise<MessageResponse> =>
      requestJson(`/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
      }),

    deleteGroup: (groupId: string): Promise<GroupDeletedResponse> =>
      requestJson(`/groups/${groupId}`, {
        method: 'DELETE',
      }),

    getPhotoCount: (groupId: string): Promise<PhotoCountResponse> =>
      requestJson(`/groups/${groupId}/photo-count`),

    updateMemberImageProtection: (
      groupId: string,
      userId: string,
      enabled: boolean
    ): Promise<MessageResponse> =>
      requestJson(`/groups/${groupId}/members/${userId}/image-protection`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
  },

  users: {
    getMe: (): Promise<MeResponse> => requestJson('/users/me'),

    getAll: (): Promise<UsersListResponse> => requestJson('/users'),

    updateProfile: (profileColor: ProfileColor): Promise<ProfileUpdatedResponse> =>
      requestJson('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profileColor }),
      }),
  },

  photos: {
    list: (limit: number = 20, offset: number = 0): Promise<PhotoListResponse> =>
      requestJson(`/photos?limit=${limit}&offset=${offset}`),

    upload: (photo: File, thumbnail: File, caption?: string): Promise<PhotoUploadResponse> => {
      const formData = new FormData();
      formData.append('photo', photo);
      formData.append('thumbnail', thumbnail);
      if (caption) {
        formData.append('caption', caption);
      }

      return requestJson('/photos', {
        method: 'POST',
        body: formData,
      });
    },

    get: (photoId: string): Promise<PhotoDetailResponse> => requestJson(`/photos/${photoId}`),

    delete: (photoId: string): Promise<MessageResponse> =>
      requestJson(`/photos/${photoId}`, {
        method: 'DELETE',
      }),

    recordView: (photoId: string): Promise<MessageResponse> =>
      requestJson(`/photos/${photoId}/view`, {
        method: 'POST',
      }),

    getViewers: (photoId: string): Promise<PhotoViewersResponse> =>
      requestJson(`/photos/${photoId}/viewers`),

    addReaction: (photoId: string, emoji: string): Promise<ReactionMutationResponse> =>
      requestJson(`/photos/${photoId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),

    removeReaction: (photoId: string, emoji: string): Promise<ReactionMutationResponse> =>
      requestJson(`/photos/${photoId}/react`, {
        method: 'DELETE',
        body: JSON.stringify({ emoji }),
      }),

    getReactions: (photoId: string): Promise<ReactionsResponse> =>
      requestJson(`/photos/${photoId}/reactions`),

    getComments: (photoId: string): Promise<CommentsResponse> =>
      requestJson(`/photos/${photoId}/comments`),

    addComment: (photoId: string, content: string): Promise<CommentCreatedResponse> =>
      requestJson(`/photos/${photoId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),

    deleteComment: (photoId: string, commentId: string): Promise<MessageResponse> =>
      requestJson(`/photos/${photoId}/comments/${commentId}`, {
        method: 'DELETE',
      }),
  },

  push: {
    getVapidPublicKey: (): Promise<VapidPublicKeyResponse> =>
      requestJson('/push/vapid-public-key', {}, false),

    subscribe: async (subscription: PushSubscriptionJSON): Promise<PushSubscribedResponse> => {
      const data = await requestJson<PushSubscribedResponse>('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
      });
      if (data.deletionToken && subscription.endpoint) {
        // Best-effort: the backend subscription already succeeded, so a failed
        // write must not reject this call. unsubscribe() below falls back to
        // the authenticated endpoint when the token is missing.
        setLocalStorageItem(`push_deletion_token:${subscription.endpoint}`, data.deletionToken);
      }
      return data;
    },

    unsubscribeFromCurrentGroup: (endpoint: string): Promise<MessageResponse> =>
      requestJson('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      }),

    getStatus: (endpoint: string): Promise<PushStatusResponse> =>
      requestJson(`/push/status?endpoint=${encodeURIComponent(endpoint)}`),

    unsubscribe: async (endpoint: string): Promise<void> => {
      const deletionToken = localStorage.getItem(`push_deletion_token:${endpoint}`);
      if (!deletionToken) {
        // The deletion token can be lost (cleared storage, failed write). Fall
        // back to the authenticated endpoint while the caller is still signed
        // in — otherwise the backend subscription outlives the session and an
        // ex-user on a shared device keeps receiving notifications.
        await api.push.unsubscribeFromCurrentGroup(endpoint);
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
    registerDevice: (platform: 'ios' | 'android', token: string): Promise<MessageResponse> =>
      requestJson('/push/device', {
        method: 'POST',
        body: JSON.stringify({ platform, token }),
      }),

    unregisterDevice: (token: string): Promise<MessageResponse> =>
      requestJson('/push/device', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      }),

    getDeviceStatus: (token: string): Promise<DeviceStatusResponse> =>
      requestJson(`/push/device/status?token=${encodeURIComponent(token)}`),

    sendTestNotification: async (
      token: string
    ): Promise<{ success?: boolean; error?: string; message?: string; debug?: unknown }> => {
      try {
        return await requestJson('/push/test', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
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
