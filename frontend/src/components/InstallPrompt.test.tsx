import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  triggerNativePrompt: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('../lib/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    platform: 'desktop',
    isInstalled: false,
    isDismissed: true,
    canSkipInstall: false,
    canPromptNatively: true,
    triggerNativePrompt: mocks.triggerNativePrompt,
    dismiss: mocks.dismiss,
  }),
}));

import { InstallButton } from './InstallPrompt';

describe('InstallButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('respects dismissal of the native install prompt', async () => {
    mocks.triggerNativePrompt.mockResolvedValue('dismissed');
    render(<InstallButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() => expect(mocks.triggerNativePrompt).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog', { name: 'Install photodrop' })).not.toBeInTheDocument();
  });

  it('shows instructions when the native prompt is unavailable', async () => {
    mocks.triggerNativePrompt.mockResolvedValue('unavailable');
    render(<InstallButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    expect(await screen.findByRole('dialog', { name: 'Install photodrop' })).toBeInTheDocument();
  });
});
