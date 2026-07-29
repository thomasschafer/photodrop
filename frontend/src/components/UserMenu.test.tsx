import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {},
  getMe: vi.fn(),
  updateProfile: vi.fn(),
  setMemberDisplayName: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: {
    users: { getMe: mocks.getMe, updateProfile: mocks.updateProfile },
    groups: { setMemberDisplayName: mocks.setMemberDisplayName },
  },
}));

vi.mock('../contexts/AuthContext', () => {
  const auth = {
    user: { id: 'me', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' as const },
    currentGroup: { id: 'g1', name: 'Family', role: 'member' as const, ownerId: 'me' },
    logout: mocks.logout,
    updateProfile: vi.fn(),
  };
  return { useAuth: () => auth };
});

import { UserMenu } from './UserMenu';

const openMenu = () => {
  render(<UserMenu />);
  const trigger = screen.getByRole('button', { name: 'Tom menu' });
  fireEvent.click(trigger);
  return trigger;
};

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMe.mockResolvedValue({
      id: 'me',
      name: 'Tom',
      currentGroupDisplayName: null,
      email: 'tom@example.com',
      profileColor: 'teal',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers name and color as separate items alongside sign out', () => {
    openMenu();

    const menu = within(screen.getByRole('menu'));
    expect(menu.getByRole('menuitem', { name: 'Change name' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Change color' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('opens the name settings dialog and returns focus to the trigger on close', async () => {
    const trigger = openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Change name' }));

    expect(await screen.findByLabelText('Display name in Family')).toBeInTheDocument();
    // Opening from a menu should land the caret in the first field, not on the
    // dialog's close button.
    expect(screen.getByLabelText('Your name')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens the color picker, which stays a surface of its own', () => {
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Change color' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Choose your color');
    expect(mocks.getMe).not.toHaveBeenCalled();
  });
});
