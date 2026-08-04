import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ownerId: 'someone-else',
  requestDeletion: vi.fn(),
  leaveGroup: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { users: { requestAccountDeletion: mocks.requestDeletion } },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Jane', email: 'jane@example.com' },
    currentGroup: { id: 'group-1', name: 'Family', ownerId: mocks.ownerId },
    leaveGroup: mocks.leaveGroup,
  }),
}));

import { AccountSettingsModal } from './AccountSettingsModal';

describe('AccountSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ownerId = 'someone-else';
  });

  it('clears an action error when returning to the main stage', async () => {
    mocks.requestDeletion.mockRejectedValue(new Error('offline'));
    render(<AccountSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email confirmation link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to send the confirmation email'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not let an owner send a request the server will reject', () => {
    mocks.ownerId = 'user-1';
    render(<AccountSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.getByRole('button', { name: 'Email confirmation link' })).toBeDisabled();
  });
});
