import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ switchGroup: vi.fn() }));

vi.mock('../contexts/AuthContext', () => {
  const groups = [
    { id: 'g1', name: 'Family', role: 'member' as const, ownerId: 'u0', imageProtection: false },
    { id: 'g2', name: 'Friends', role: 'member' as const, ownerId: 'u0', imageProtection: false },
  ];
  const auth = {
    user: { id: 'u1', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' as const },
    currentGroup: groups[0],
    groups,
    switchGroup: mocks.switchGroup,
  };
  return { useAuth: () => auth };
});

import { GroupSwitcher } from './GroupSwitcher';

function selectOtherGroup() {
  const trigger = screen.getByRole('button', { name: /Family/ });
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Friends/ }));
  return trigger;
}

describe('GroupSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns focus to the trigger once the switch completes', async () => {
    let finishSwitch!: () => void;
    mocks.switchGroup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        })
    );

    render(<GroupSwitcher />);
    const trigger = selectOtherGroup();

    // The trigger is disabled while switching, so it cannot hold focus yet.
    expect(trigger).toBeDisabled();

    await act(async () => {
      finishSwitch();
    });

    expect(trigger).toBeEnabled();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger when the switch fails', async () => {
    let failSwitch!: (err: Error) => void;
    mocks.switchGroup.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSwitch = reject;
        })
    );

    render(<GroupSwitcher />);
    const trigger = selectOtherGroup();

    await act(async () => {
      failSwitch(new Error('network down'));
    });

    expect(trigger).toHaveFocus();
  });
});
