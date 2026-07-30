import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode, type ReactElement } from 'react';
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
  useAuth: () => ({ login: mockLogin, user: null, loading: false }),
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

// `strict` opts a test into StrictMode's double effect invocation, which is
// what the verify guard exists for in the first place.
function harnessTree(strict = false): ReactElement {
  const tree = (
    <MemoryRouter initialEntries={['/auth/first-token']}>
      <Harness />
    </MemoryRouter>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}

function renderHarness(strict = false) {
  return render(harnessTree(strict));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AuthVerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
  });

  it('verifies the token exactly once for a given token value, even under StrictMode', async () => {
    // A magic link is single-use, so a repeated verify burns it. StrictMode is
    // the case the guard exists for — it mounts, tears down and re-runs the
    // effect — and the guard also has to survive plain re-renders of the same
    // token.
    mockVerifyMagicLink.mockResolvedValue({
      accessToken: 'token-a',
      user,
      currentGroup: group,
      groups: [group],
    });

    const { rerender } = renderHarness(true);
    await screen.findByText("You're signed in");

    rerender(harnessTree(true));

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
    expect(mockLogin).toHaveBeenCalledWith('token-b', user, group, [group], false, null, null);
    await screen.findByText("You're signed in");
  });

  it('ignores a success from a link that has been superseded', async () => {
    // The first request is still in the air when the user opens a second link.
    // Letting it land would sign them in as whoever the abandoned link belongs
    // to, over the top of the link they actually opened.
    const first = deferred<unknown>();
    mockVerifyMagicLink.mockImplementation((t: string) =>
      t === 'first-token'
        ? first.promise
        : Promise.resolve({ accessToken: 'token-b', user, currentGroup: group, groups: [group] })
    );

    renderHarness();
    await screen.findByText('Verifying your link...');

    await act(async () => {
      screen.getByText('open second link').click();
    });
    await screen.findByText("You're signed in");
    expect(mockLogin).toHaveBeenCalledTimes(1);

    const otherUser = { ...user, id: 'u2', name: 'Ada', email: 'ada@example.com' };
    await act(async () => {
      first.resolve({
        accessToken: 'token-a',
        user: otherUser,
        currentGroup: group,
        groups: [group],
      });
    });

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith('token-b', user, group, [group], false, null, null);
  });

  it('ignores a failure from a link that has been superseded', async () => {
    // Same race on the error path: the abandoned link's rejection must not
    // replace the new link's screen with "Link not valid".
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = deferred<unknown>();
    mockVerifyMagicLink.mockImplementation((t: string) =>
      t === 'first-token' ? first.promise : Promise.resolve({ needsName: true })
    );

    renderHarness();
    await screen.findByText('Verifying your link...');

    await act(async () => {
      screen.getByText('open second link').click();
    });
    await screen.findByText('Welcome!');

    await act(async () => {
      first.reject(new ApiError(400, 'Bad Request', 'This link has expired'));
    });

    expect(screen.queryByText('Link not valid')).toBeNull();
    expect(screen.getByText('Welcome!')).toBeTruthy();

    consoleError.mockRestore();
  });
});
