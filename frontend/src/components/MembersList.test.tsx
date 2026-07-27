import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {},
  getMembers: vi.fn(),
  updateMemberImageProtection: vi.fn(),
  setMemberDisplayName: vi.fn(),
  setNativeScreenshotProtection: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: {
    groups: {
      getMembers: mocks.getMembers,
      updateMemberImageProtection: mocks.updateMemberImageProtection,
      setMemberDisplayName: mocks.setMemberDisplayName,
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

function makeMember(userId: string, name: string, displayName: string | null = null) {
  return {
    userId,
    name,
    displayName,
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

describe('MembersList display names', () => {
  const openEditor = (name: string) =>
    fireEvent.click(screen.getByRole('button', { name: `Set ${name}'s display name in Family` }));
  const displayNameField = () => screen.getByLabelText('Display name in Family');
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  async function renderMembers(members: ReturnType<typeof makeMember>[]) {
    mocks.getMembers.mockResolvedValue({ members, ownerId: 'someone-else' });
    render(<MembersList />);
    await screen.findByText(members[0].name);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setNativeScreenshotProtection.mockResolvedValue(undefined);
    // The component logs every failure it handles; keep test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags only the members shown under an override', async () => {
    await renderMembers([makeMember('alice', 'Ali', 'Ali'), makeMember('bob', 'Bob')]);

    const badges = screen.getAllByText('Display name');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute(
      'title',
      'A display name is set for Family, so this is not their own name'
    );
  });

  it('offers the member’s own name as the default when no override is set', async () => {
    await renderMembers([makeMember('alice', 'Alice')]);

    openEditor('Alice');

    expect(displayNameField()).toHaveValue('');
    expect(displayNameField()).toHaveAttribute('placeholder', 'Alice');
    expect(
      screen.getByText('Leave empty to keep showing their own name, Alice.')
    ).toBeInTheDocument();
  });

  it('sets a display name and relabels the row with the resolved name', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'alice',
      displayName: 'Ali',
      name: 'Ali',
    });
    await renderMembers([makeMember('alice', 'Alice')]);

    openEditor('Alice');
    fireEvent.change(displayNameField(), { target: { value: '  Ali  ' } });
    save();

    await waitFor(() => expect(screen.getByText('Ali')).toBeInTheDocument());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'alice', 'Ali');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getAllByText('Display name')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Now showing as Ali in Family');
  });

  it('clears the override from an empty field and restores the member’s own name', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'alice',
      displayName: null,
      name: 'Alice',
    });
    await renderMembers([makeMember('alice', 'Ali', 'Ali')]);

    openEditor('Ali');
    // An empty field is how the override is cleared, so Save must stay live.
    fireEvent.change(displayNameField(), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    save();

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'alice', null);
    expect(screen.queryByText('Display name')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Alice is now shown under their own name');
  });

  it('skips the request when the field is left unchanged', async () => {
    await renderMembers([makeMember('alice', 'Ali', 'Ali')]);

    openEditor('Ali');
    save();

    await waitFor(() => expect(screen.queryByLabelText('Display name in Family')).toBeNull());
    expect(mocks.setMemberDisplayName).not.toHaveBeenCalled();
  });

  it('surfaces a rejected change and leaves the row as it was', async () => {
    mocks.setMemberDisplayName.mockRejectedValue(
      new mocks.ApiError('You can only change your own display name')
    );
    await renderMembers([makeMember('alice', 'Alice')]);

    openEditor('Alice');
    fireEvent.change(displayNameField(), { target: { value: 'Ali' } });
    save();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You can only change your own display name'
      )
    );
    // The row still names Alice, and the editor stays open on what was typed so
    // the change can be retried rather than retyped.
    expect(
      screen.getByRole('button', { name: "Set Alice's display name in Family" })
    ).toBeInTheDocument();
    expect(displayNameField()).toHaveValue('Ali');
  });
});
