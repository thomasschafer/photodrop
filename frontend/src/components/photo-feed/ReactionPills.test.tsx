import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
        onAddClick={vi.fn()}
        showPicker={false}
        reactionDetails={staleDetails}
        currentUserId="me"
        showNames
      />
    );

    const pill = screen.getByLabelText('Remove ❤️ reaction');
    expect(pill.textContent).toContain('2');
    expect(pill.textContent).not.toContain('1');
  });

  it('invokes onReactionClick with the tapped emoji', () => {
    const onReactionClick = vi.fn();

    render(
      <ReactionPills
        reactions={[{ emoji: '🔥', count: 1 }]}
        userReaction={null}
        onReactionClick={onReactionClick}
        onAddClick={vi.fn()}
        showPicker={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'));
    expect(onReactionClick).toHaveBeenCalledWith('🔥');
  });
});
