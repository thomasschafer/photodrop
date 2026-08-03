import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  requestDeletion: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { users: { requestAccountDeletionWithoutGroup: mocks.requestDeletion } },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Jane', email: 'jane@example.com' },
    groups: [],
    selectGroup: vi.fn(),
    logout: mocks.logout,
  }),
}));

import { GroupPickerPage } from './GroupPickerPage';
import { ApiError } from '../lib/api';

function renderPage() {
  return render(
    <MemoryRouter>
      <GroupPickerPage />
    </MemoryRouter>
  );
}

describe('GroupPickerPage without memberships', () => {
  beforeEach(() => {
    mocks.requestDeletion.mockReset();
    mocks.logout.mockReset();
  });

  it('lets a stranded signed-in user request account deletion', async () => {
    mocks.requestDeletion.mockResolvedValue({ message: 'sent' });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(mocks.requestDeletion).toHaveBeenCalledWith('jane@example.com'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Check your email to confirm account deletion.'
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('keeps the account actions usable when the request fails', async () => {
    mocks.requestDeletion.mockRejectedValue(new Error('offline'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to send the confirmation email'
    );
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
  });

  it('shows the API explanation when the deletion request is rejected', async () => {
    mocks.requestDeletion.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'Transfer ownership before deleting your account')
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Transfer ownership before deleting your account'
    );
  });
});
