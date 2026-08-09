import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {},
  getMembers: vi.fn(),
  updateMemberImageProtection: vi.fn(),
  setMemberDisplayName: vi.fn(),
  exportGroup: vi.fn(),
}));

vi.mock('../lib/groupExport', () => ({ exportGroup: mocks.exportGroup }));

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

// `name` is what the group sees, so it defaults the canonical name only for
// members with no override — an overridden member must be given both.
function makeMember(
  userId: string,
  name: string,
  displayName: string | null = null,
  canonicalName: string = name
) {
  return {
    userId,
    name,
    displayName,
    canonicalName,
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

  it('keeps a server-confirmed toggle and announces it', async () => {
    mocks.getMembers.mockResolvedValue({
      members: [makeMember('me', 'Me')],
      ownerId: 'someone-else',
    });
    mocks.updateMemberImageProtection.mockResolvedValue(undefined);

    render(<MembersList />);
    await screen.findByRole('button', { name: 'Enable image protection for Me' });

    fireEvent.click(protectionToggle('Me', false));

    await waitFor(() => expect(protectionToggle('Me', true)).toBeInTheDocument());
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
    // The component logs every failure it handles; keep test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags only the members shown under an override', async () => {
    await renderMembers([
      makeMember('alice', 'Ali', 'Ali', 'Alice Smith'),
      makeMember('bob', 'Bob'),
    ]);

    const badges = screen.getAllByText('Display name');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute(
      'title',
      'A display name is set for Family, so this is not their own name'
    );
  });

  it('names the person behind an override, and only where one is set', async () => {
    await renderMembers([
      makeMember('alice', 'Ali', 'Ali', 'Alice Smith'),
      makeMember('bob', 'Bob'),
    ]);

    // Labelled rather than left as a second bare name, so it cannot be read as
    // a different member.
    expect(screen.getByText('Own name: Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Own name: Bob')).not.toBeInTheDocument();
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

  it('names what clearing an override reverts to, and never offers it for editing', async () => {
    await renderMembers([makeMember('alice', 'Ali', 'Ali', 'Alice Smith')]);

    openEditor('Ali');

    expect(screen.getByText(/is shown as/)).toHaveTextContent(
      'Alice Smith is shown as Ali in Family. Their own name is theirs alone to change; this one applies only to Family.'
    );
    expect(
      screen.getByText('Leave empty to go back to showing their own name, Alice Smith.')
    ).toBeInTheDocument();
    // The one editable field is the override: the canonical name is shown only
    // as the placeholder the empty field falls back to.
    expect(displayNameField()).toHaveValue('Ali');
    expect(displayNameField()).toHaveAttribute('placeholder', 'Alice Smith');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('sets a display name and relabels the row with the resolved name', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'alice',
      displayName: 'Ali',
      name: 'Ali',
      canonicalName: 'Alice',
    });
    await renderMembers([makeMember('alice', 'Alice')]);

    openEditor('Alice');
    fireEvent.change(displayNameField(), { target: { value: '  Ali  ' } });
    save();

    await waitFor(() => expect(screen.getByText('Ali')).toBeInTheDocument());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'alice', 'Ali');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Own name: Alice')).toBeInTheDocument();
    expect(screen.getAllByText('Display name')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Now showing as Ali in Family');
  });

  it('takes the canonical name from the response, so a row cannot go stale', async () => {
    // The member renamed themselves after this list was fetched; the response
    // is re-read server-side, so the row must follow it rather than the name it
    // was rendered with.
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'alice',
      displayName: 'Ali B',
      name: 'Ali B',
      canonicalName: 'Alice Jones',
    });
    await renderMembers([makeMember('alice', 'Ali', 'Ali', 'Alice Smith')]);

    openEditor('Ali');
    fireEvent.change(displayNameField(), { target: { value: 'Ali B' } });
    save();

    await waitFor(() => expect(screen.getByText('Own name: Alice Jones')).toBeInTheDocument());
    expect(screen.queryByText('Own name: Alice Smith')).not.toBeInTheDocument();
  });

  it('clears the override from an empty field and restores the member’s own name', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'alice',
      displayName: null,
      name: 'Alice',
      canonicalName: 'Alice',
    });
    await renderMembers([makeMember('alice', 'Ali', 'Ali', 'Alice')]);

    openEditor('Ali');
    // An empty field is how the override is cleared, so Save must stay live.
    fireEvent.change(displayNameField(), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    save();

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'alice', null);
    expect(screen.queryByText('Display name')).not.toBeInTheDocument();
    // With no override the name in the row is already the member's own, so
    // repeating it under the email would be noise.
    expect(screen.queryByText('Own name: Alice')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Alice is now shown under their own name');
  });

  it('skips the request when the field is left unchanged', async () => {
    await renderMembers([makeMember('alice', 'Ali', 'Ali', 'Alice Smith')]);

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

describe('MembersList group export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getMembers.mockResolvedValue({
      members: [makeMember('alice', 'Alice')],
      ownerId: 'someone-else',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Starts an export that reports one photo done, then hangs until settled. */
  async function startExport() {
    let capturedSignal: AbortSignal | undefined;
    let settle!: (outcome: { status: 'downloaded' | 'cancelled' }) => void;
    mocks.exportGroup.mockImplementation(
      (
        _groupId: string,
        onProgress?: (progress: { completed: number; total: number }) => void,
        signal?: AbortSignal
      ) => {
        capturedSignal = signal;
        onProgress?.({ completed: 1, total: 3 });
        return new Promise((resolve) => {
          settle = resolve;
        });
      }
    );

    const { unmount } = render(<MembersList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export group' }));

    return { getSignal: () => capturedSignal, settle: () => settle, unmount };
  }

  it('aborts the run and reports it when cancel is clicked', async () => {
    const { getSignal, settle } = await startExport();

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.getByRole('button', { name: 'Exporting 1/3…' })).toBeDisabled();

    fireEvent.click(cancel);
    expect(getSignal()?.aborted).toBe(true);

    await act(async () => settle()({ status: 'cancelled' }));

    // Cancelling is reported as an outcome, not an error, and the button is
    // usable again so the export can be restarted.
    expect(screen.getByText('Group export cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export group' })).toBeEnabled();
  });

  it('offers no cancel until an export is running', async () => {
    render(<MembersList />);
    await screen.findByRole('button', { name: 'Export group' });

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('aborts a running export when the page goes away', async () => {
    const { getSignal, unmount } = await startExport();
    expect(getSignal()?.aborted).toBe(false);

    unmount();

    expect(getSignal()?.aborted).toBe(true);
  });
});
