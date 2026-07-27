import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { AuthVerifyPage } from './AuthVerifyPage';
import { ApiError } from '../lib/api';

const mockVerifyMagicLink = vi.fn();
const mockLogin = vi.fn().mockResolvedValue(undefined);

// Mock only the network surface; the real ApiError is kept so the page's
// instanceof-based error classification is the one under test.
vi.mock('../lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      auth: { verifyMagicLink: (...args: unknown[]) => mockVerifyMagicLink(...args) },
    },
  };
});

// api.ts reads Capacitor.isNativePlatform() at module load.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

const user = { id: 'u1', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' as const };
const group = {
  id: 'g1',
  name: 'Family',
  role: 'member' as const,
  ownerId: 'u0',
  imageProtection: true,
};

// Renders the verify page under a stable route so navigating from one token to
// another reuses the same component instance — which is exactly the case a
// boolean "already attempted" guard breaks.
function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/auth/second-token')}>open second link</button>
      <Routes>
        <Route path="/auth/:token" element={<AuthVerifyPage />} />
      </Routes>
    </>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={['/auth/first-token']}>
      <Harness />
    </MemoryRouter>
  );
}

describe('AuthVerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
  });

  it('verifies the token exactly once for a given token value', async () => {
    // A magic link is single-use, so a repeated verify burns it. The guard has
    // to survive re-renders of the same token.
    mockVerifyMagicLink.mockResolvedValue({
      accessToken: 'token-a',
      user,
      currentGroup: group,
      groups: [group],
    });

    const { rerender } = renderHarness();
    await screen.findByText("You're signed in");

    rerender(
      <MemoryRouter initialEntries={['/auth/first-token']}>
        <Harness />
      </MemoryRouter>
    );

    expect(mockVerifyMagicLink).toHaveBeenCalledTimes(1);
  });

  it('verifies a second token opened from the first link error screen', async () => {
    mockVerifyMagicLink.mockRejectedValueOnce(
      new ApiError(400, 'Bad Request', 'This link has expired')
    );

    renderHarness();
    await screen.findByText('This link has expired. Please request a new one.');

    mockVerifyMagicLink.mockResolvedValueOnce({
      accessToken: 'token-b',
      user,
      currentGroup: group,
      groups: [group],
    });

    await act(async () => {
      screen.getByText('open second link').click();
    });

    // The instance is reused, so a boolean guard would have left the stale
    // error screen up and never re-verified.
    expect(mockVerifyMagicLink).toHaveBeenNthCalledWith(2, 'second-token');
    expect(mockLogin).toHaveBeenCalledWith('token-b', user, group, [group], false, null);
    await screen.findByText("You're signed in");
  });
});
