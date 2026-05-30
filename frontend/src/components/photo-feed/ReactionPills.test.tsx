import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReactionPills } from './ReactionPills';
import type { ReactionWithUser } from './types';

describe('ReactionPills', () => {
  it('shows counts from the reactions summary, not the lazily-loaded details', () => {
    // Simulates the race that broke reactions on iOS: an optimistic update has
    // bumped the summary to 2, but the detail list (loaded async for names) is
    // still the stale pre-reaction state with a single reactor. The displayed
    // count must follow the summary (2), not the details (1).
    const staleDetails: ReactionWithUser[] = [
      { emoji: '❤️', userId: 'other-user', userName: 'Bob', profileColor: 'teal' },
    ];

    render(
      <ReactionPills
        reactions={[{ emoji: '❤️', count: 2 }]}
        userReaction="❤️"
        onReactionClick={vi.fn()}
        reactionDetails={staleDetails}
        currentUserId="me"
        showNames
      />
    );

    const pill = screen.getByLabelText('Remove ❤️ reaction');
    expect(pill.textContent).toContain('2');
    expect(pill.textContent).not.toContain('1');
  });

  it('invokes onReactionClick when an existing pill is tapped', () => {
    const onReactionClick = vi.fn();

    render(
      <ReactionPills
        reactions={[{ emoji: '🔥', count: 1 }]}
        userReaction={null}
        onReactionClick={onReactionClick}
      />
    );

    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'));
    expect(onReactionClick).toHaveBeenCalledWith('🔥');
  });

  it('opens its own picker and selects an emoji from it', () => {
    const onReactionClick = vi.fn();

    render(<ReactionPills reactions={[]} userReaction={null} onReactionClick={onReactionClick} />);

    // No picker until the trigger is tapped (ReactionPills owns this now).
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    const picker = screen.getByRole('listbox', { name: 'Select reaction' });

    fireEvent.click(within(picker).getByRole('option', { name: 'React with 😂' }));

    expect(onReactionClick).toHaveBeenCalledWith('😂');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
