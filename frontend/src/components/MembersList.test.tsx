import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getMembers: vi.fn(),
  updateMemberImageProtection: vi.fn(),
  setNativeScreenshotProtection: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    groups: {
      getMembers: mocks.getMembers,
      updateMemberImageProtection: mocks.updateMemberImageProtection,
    },
  },
}));

vi.mock('../lib/privacyScreen', () => ({
  setNativeScreenshotProtection: mocks.setNativeScreenshotProtection,
}));

// A stable auth value: the component's member fetch is keyed on the identity
// of currentGroup, so a fresh object per render would refetch on every render
// and overwrite the optimistic updates under test.
vi.mock('../contexts/AuthContext', () => {
  const auth = {
    user: { id: 'me', name: 'Me', email: 'me@example.com', profileColor: 'teal' },
    currentGroup: { id: 'g1', name: 'Family' },
    onGroupDeleted: vi.fn(),
  };
  return { useAuth: () => auth };
});

import { MembersList } from './MembersList';

function makeMember(userId: string, name: string) {
  return {
    userId,
    name,
    email: `${userId}@example.com`,
    profileColor: 'teal' as const,
    role: 'member' as const,
    joinedAt: 0,
    imageProtection: false,
  };
}

const protectionToggle = (name: string, on: boolean) =>
  screen.getByRole('button', {
    name: on ? `Disable image protection for ${name}` : `Enable image protection for ${name}`,
  });

describe('MembersList image protection toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setNativeScreenshotProtection.mockResolvedValue(undefined);
    // The component logs every failure it handles; keep test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reverts only the failed member, keeping a concurrent toggle of another member', async () => {
    mocks.getMembers.mockResolvedValue({
      members: [makeMember('alice', 'Alice'), makeMember('bob', 'Bob')],
      ownerId: 'someone-else',
    });

    let rejectAlice!: (err: Error) => void;
    mocks.updateMemberImageProtection.mockImplementation((_groupId: string, memberId: string) =>
      memberId === 'alice'
        ? new Promise((_resolve, reject) => {
            rejectAlice = reject;
          })
        : Promise.resolve(undefined)
    );

    render(<MembersList />);
    await screen.findByRole('button', { name: 'Enable image protection for Alice' });

    // Alice's request is left in flight while Bob's succeeds; only Alice's own
    // row is disabled, so this ordering is reachable from the UI.
    fireEvent.click(protectionToggle('Alice', false));
    fireEvent.click(protectionToggle('Bob', false));
    await waitFor(() => expect(protectionToggle('Bob', true)).toBeInTheDocument());

    await act(async () => {
      rejectAlice(new Error('network down'));
    });

    expect(protectionToggle('Alice', false)).toBeInTheDocument();
    expect(protectionToggle('Bob', true)).toBeInTheDocument();
  });

  it('keeps the server-confirmed toggle when the native privacy screen fails', async () => {
    mocks.getMembers.mockResolvedValue({
      members: [makeMember('me', 'Me')],
      ownerId: 'someone-else',
    });
    mocks.updateMemberImageProtection.mockResolvedValue(undefined);
    mocks.setNativeScreenshotProtection.mockRejectedValue(new Error('plugin unavailable'));

    render(<MembersList />);
    await screen.findByRole('button', { name: 'Enable image protection for Me' });

    fireEvent.click(protectionToggle('Me', false));

    await waitFor(() => expect(protectionToggle('Me', true)).toBeInTheDocument());
    // Flush the rejected native call: the server already persisted the change,
    // so it must not drag the row back to the opposite of what's stored.
    await act(async () => {});

    expect(protectionToggle('Me', true)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Image protection enabled for Me');
  });

  it('reports an error and reverts when the server rejects the toggle', async () => {
    mocks.getMembers.mockResolvedValue({
      members: [makeMember('alice', 'Alice')],
      ownerId: 'someone-else',
    });
    mocks.updateMemberImageProtection.mockRejectedValue(new Error('network down'));

    render(<MembersList />);
    await screen.findByRole('button', { name: 'Enable image protection for Alice' });

    fireEvent.click(protectionToggle('Alice', false));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to update image protection: network down'
      )
    );
    expect(protectionToggle('Alice', false)).toBeInTheDocument();
    expect(mocks.setNativeScreenshotProtection).not.toHaveBeenCalled();
  });
});
