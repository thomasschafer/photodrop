import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getMe: vi.fn(),
  updateProfile: vi.fn(),
  setMemberDisplayName: vi.fn(),
  // A stable auth value: the display-name fetch is keyed on the current group,
  // so a fresh object per render would refetch and clobber what was typed.
  // updateProfile mutates it the way the real context does, so the component
  // sees the new canonical name on the next render.
  auth: {
    user: { id: 'me', name: 'Tom Schafer', email: 'tom@example.com', profileColor: 'teal' },
    currentGroup: { id: 'g1', name: 'Family', role: 'member', ownerId: 'me' },
    updateProfile: vi.fn(),
    setDisplayNameOverride: vi.fn(),
  },
}));

vi.mock('../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: {
    users: { getMe: mocks.getMe, updateProfile: mocks.updateProfile },
    groups: { setMemberDisplayName: mocks.setMemberDisplayName },
  },
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));

import { NameSettingsModal } from './NameSettingsModal';

const nameInput = () => screen.getByLabelText('Your name');
const displayNameInput = () => screen.getByLabelText('Display name in Family');
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

async function renderReady(currentGroupDisplayName: string | null) {
  mocks.getMe.mockResolvedValue({
    id: 'me',
    name: 'Tom Schafer',
    currentGroupDisplayName,
    email: 'tom@example.com',
    profileColor: 'teal',
  });
  const onClose = vi.fn();
  render(<NameSettingsModal onClose={onClose} />);
  await screen.findByLabelText('Display name in Family');
  return onClose;
}

describe('NameSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = {
      id: 'me',
      name: 'Tom Schafer',
      email: 'tom@example.com',
      profileColor: 'teal',
    };
    mocks.auth.updateProfile.mockImplementation((update: Record<string, unknown>) => {
      mocks.auth.user = { ...mocks.auth.user, ...update };
    });
    mocks.updateProfile.mockResolvedValue({
      message: 'Profile updated',
      name: 'Tom Schafer',
      profileColor: 'teal',
    });
    // The component logs every failure it handles; keep test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the canonical name and offers it as the display-name default', async () => {
    await renderReady(null);

    expect(nameInput()).toHaveValue('Tom Schafer');
    expect(displayNameInput()).toHaveValue('');
    // The placeholder is what tells the user an empty field means "my own name"
    // rather than "no name".
    expect(displayNameInput()).toHaveAttribute('placeholder', 'Tom Schafer');
  });

  it('leaves focus on the autofocused field and keeps Tab inside the modal', async () => {
    // Covers what Modal contributes here: it focuses its close button on mount
    // only when nothing inside has already claimed focus (otherwise everything
    // typed into this field would go nowhere), and it traps Tab so the page
    // behind the dialog stays unreachable.
    await renderReady(null);

    expect(nameInput()).toHaveFocus();

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'));
    expect(focusable.length).toBeGreaterThan(1);

    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(focusable[0]).toHaveFocus();
  });

  it('does not present a per-group display name as hiding the canonical one', async () => {
    await renderReady(null);

    // A group admin sees both names in the members list, so the hint must not
    // read as a promise of concealment from the group.
    expect(
      screen.getByText(/Group admins can see both names/, { selector: 'p,span,div' })
    ).toBeInTheDocument();
  });

  it('loads an existing override into the display-name field', async () => {
    await renderReady('Dad');

    expect(displayNameInput()).toHaveValue('Dad');
  });

  it('saves a changed canonical name and applies what the server stored', async () => {
    mocks.updateProfile.mockResolvedValue({
      message: 'Profile updated',
      name: 'Thomas Schafer',
      profileColor: 'teal',
    });
    const onClose = await renderReady(null);

    fireEvent.change(nameInput(), { target: { value: '  Thomas Schafer  ' } });
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateProfile).toHaveBeenCalledWith({ name: 'Thomas Schafer' });
    expect(mocks.auth.updateProfile).toHaveBeenCalledWith({
      name: 'Thomas Schafer',
      profileColor: 'teal',
    });
    expect(mocks.setMemberDisplayName).not.toHaveBeenCalled();
  });

  it('sets a trimmed display name without touching the canonical name', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'me',
      displayName: 'Dad',
      name: 'Dad',
    });
    const onClose = await renderReady(null);

    fireEvent.change(displayNameInput(), { target: { value: '  Dad  ' } });
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'me', 'Dad');
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('clears the override when the display-name field is emptied', async () => {
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'me',
      displayName: null,
      name: 'Tom Schafer',
    });
    const onClose = await renderReady('Dad');

    fireEvent.change(displayNameInput(), { target: { value: '   ' } });
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.setMemberDisplayName).toHaveBeenCalledWith('g1', 'me', null);
  });

  it('closes without any request when nothing changed', async () => {
    const onClose = await renderReady('Dad');

    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.setMemberDisplayName).not.toHaveBeenCalled();
  });

  it('refuses to save an empty canonical name', async () => {
    const onClose = await renderReady(null);

    fireEvent.change(nameInput(), { target: { value: '   ' } });
    save();

    expect(await screen.findByRole('alert')).toHaveTextContent('Your name cannot be empty.');
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never sends a display-name update when the stored override could not be loaded', async () => {
    mocks.getMe.mockRejectedValue(new Error('network down'));
    const onClose = vi.fn();
    render(<NameSettingsModal onClose={onClose} />);

    // Without the stored value, an editable (and therefore blank) field would be
    // a standing offer to wipe an override the user can't see, so it is hidden.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load your display name in Family"
    );
    expect(screen.queryByLabelText('Display name in Family')).not.toBeInTheDocument();

    fireEvent.change(nameInput(), { target: { value: 'Thomas Schafer' } });
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.setMemberDisplayName).not.toHaveBeenCalled();
  });

  it('surfaces a rejected display name and retries only what is still unsaved', async () => {
    mocks.updateProfile.mockResolvedValue({
      message: 'Profile updated',
      name: 'Thomas Schafer',
      profileColor: 'teal',
    });
    mocks.setMemberDisplayName.mockRejectedValueOnce(
      new mocks.ApiError(403, 'You can only change your own display name')
    );
    const onClose = await renderReady(null);

    fireEvent.change(nameInput(), { target: { value: 'Thomas Schafer' } });
    fireEvent.change(displayNameInput(), { target: { value: 'Dad' } });
    save();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You can only change your own display name'
      )
    );
    expect(onClose).not.toHaveBeenCalled();

    // The canonical name was stored before the failure and auth state now
    // reports it, so retrying must not send it a second time.
    mocks.setMemberDisplayName.mockResolvedValue({
      message: 'Display name updated',
      userId: 'me',
      displayName: 'Dad',
      name: 'Dad',
    });
    mocks.updateProfile.mockClear();
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.setMemberDisplayName).toHaveBeenCalledTimes(2);
  });
});
