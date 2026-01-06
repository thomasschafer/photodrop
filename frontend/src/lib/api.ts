const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  includeAuth: boolean = true
): Promise<Response> {
  const headers: HeadersInit = {
    ...options.headers,
  };

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
    acceptInvite: async (inviteToken: string) => {
      const response = await fetchWithAuth(
        '/api/auth/accept-invite',
        {
          method: 'POST',
          body: JSON.stringify({ inviteToken }),
        },
        false
      );
      return response.json();
    },

    refresh: async () => {
      const response = await fetchWithAuth('/api/auth/refresh', { method: 'POST' }, false);
      return response.json();
    },

    logout: async () => {
      const response = await fetchWithAuth('/api/auth/logout', {
        method: 'POST',
      });
      return response.json();
    },

    createInvite: async (name: string, role: 'admin' | 'viewer' = 'viewer', phone?: string) => {
      const response = await fetchWithAuth('/api/auth/create-invite', {
        method: 'POST',
        body: JSON.stringify({ name, role, phone }),
      });
      return response.json();
    },
  },

  users: {
    getMe: async () => {
      const response = await fetchWithAuth('/api/users/me');
      return response.json();
    },

    getAll: async () => {
      const response = await fetchWithAuth('/api/users');
      return response.json();
    },

    updateRole: async (userId: string, role: 'admin' | 'viewer') => {
      const response = await fetchWithAuth(`/api/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      return response.json();
    },

    delete: async (userId: string) => {
      const response = await fetchWithAuth(`/api/users/${userId}`, {
        method: 'DELETE',
      });
      return response.json();
    },
  },

  photos: {
    list: async (limit: number = 20, offset: number = 0) => {
      const response = await fetchWithAuth(`/api/photos?limit=${limit}&offset=${offset}`);
      return response.json();
    },

    upload: async (photo: File, thumbnail: File, caption?: string) => {
      const formData = new FormData();
      formData.append('photo', photo);
      formData.append('thumbnail', thumbnail);
      if (caption) {
        formData.append('caption', caption);
      }

      const response = await fetchWithAuth('/api/photos', {
        method: 'POST',
        body: formData,
      });
      return response.json();
    },

    get: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}`);
      return response.json();
    },

    getUrl: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/url`);
      return response.json();
    },

    getThumbnailUrl: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/thumbnail-url`);
      return response.json();
    },

    delete: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    recordView: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/view`, {
        method: 'POST',
      });
      return response.json();
    },

    getViewers: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/viewers`);
      return response.json();
    },

    addReaction: async (photoId: string, emoji: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      return response.json();
    },

    removeReaction: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/react`, {
        method: 'DELETE',
      });
      return response.json();
    },

    getReactions: async (photoId: string) => {
      const response = await fetchWithAuth(`/api/photos/${photoId}/reactions`);
      return response.json();
    },
  },
};

export { ApiError };
