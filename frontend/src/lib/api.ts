function getApiBaseUrl(): string {
  const hostname = window.location.hostname;

  // Local development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8787';
  }

  // Production - API is at api.{domain}
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

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  includeAuth: boolean = true
): Promise<Response> {
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

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      response.statusText,
      errorData.error || 'An error occurred'
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

    verifyMagicLink: async (token: string, name?: string) => {
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

    refresh: async () => {
      const response = await fetchWithAuth('/auth/refresh', { method: 'POST' }, false);
      return response.json();
    },

    logout: async () => {
      const response = await fetchWithAuth('/auth/logout', {
        method: 'POST',
      });
      return response.json();
    },

    switchGroup: async (groupId: string) => {
      const response = await fetchWithAuth('/auth/switch-group', {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      });
      return response.json();
    },

    selectGroup: async (userId: string, groupId: string) => {
      const response = await fetchWithAuth(
        '/auth/select-group',
        {
          method: 'POST',
          body: JSON.stringify({ userId, groupId }),
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
  },

  users: {
    getMe: async () => {
      const response = await fetchWithAuth('/users/me');
      return response.json();
    },

    getAll: async () => {
      const response = await fetchWithAuth('/users');
      return response.json();
    },

    updateRole: async (userId: string, role: 'admin' | 'viewer') => {
      const response = await fetchWithAuth(`/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      return response.json();
    },

    delete: async (userId: string) => {
      const response = await fetchWithAuth(`/users/${userId}`, {
        method: 'DELETE',
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

    removeReaction: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/react`, {
        method: 'DELETE',
      });
      return response.json();
    },

    getReactions: async (photoId: string) => {
      const response = await fetchWithAuth(`/photos/${photoId}/reactions`);
      return response.json();
    },
  },
};

export { ApiError };
