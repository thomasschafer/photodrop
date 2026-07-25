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
        userReactions={['❤️']}
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
        userReactions={[]}
        onReactionClick={onReactionClick}
      />
    );

    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'));
    expect(onReactionClick).toHaveBeenCalledWith('🔥');
  });

  it('opens the picker on a horizontal arrow without leaking the key to the lightbox', () => {
    // The lightbox navigates photos from a document-level (bubble-phase) keydown
    // listener on the same left/right keys. With focus on the trigger, opening
    // the picker must not also reach that listener and flip to another photo.
    const documentKeyDown = vi.fn();
    document.addEventListener('keydown', documentKeyDown);

    try {
      render(<ReactionPills reactions={[]} userReactions={[]} onReactionClick={vi.fn()} />);

      const trigger = screen.getByRole('button', { name: 'Add reaction' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowRight' });

      // Picker opened, and the event was stopped before bubbling to document.
      expect(screen.getByRole('listbox', { name: 'Select reaction' })).toBeInTheDocument();
      expect(documentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentKeyDown);
    }
  });

  it('prevents mousedown inside the picker from moving focus (Safari focus steal)', () => {
    // macOS Safari does not focus buttons on mousedown; it focuses the nearest
    // mouse-focusable ancestor instead — in the feed, the tabIndex={0} photo
    // card. If that default is not prevented, the focus move blurs the picker,
    // which closes and unmounts the emoji option before its click event fires,
    // so the reaction is never added. Cancelling the mousedown default is the
    // contract that stops the focus steal.
    const onReactionClick = vi.fn();

    render(
      <div tabIndex={0}>
        <ReactionPills reactions={[]} userReactions={[]} onReactionClick={onReactionClick} />
      </div>
    );

    const trigger = screen.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'React with 😂' });

    // fireEvent returns false when the event's default was prevented.
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onReactionClick).toHaveBeenCalledWith('😂');

    // The trigger is focused explicitly on its own mousedown, replacing the
    // native focus that preventDefault suppresses, so relatedTarget stays
    // inside the container and toggling the picker closed keeps working.
    fireEvent.click(trigger);
    expect(fireEvent.mouseDown(trigger)).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it('opens its own picker and selects an emoji from it', () => {
    const onReactionClick = vi.fn();

    render(<ReactionPills reactions={[]} userReactions={[]} onReactionClick={onReactionClick} />);

    // No picker until the trigger is tapped (ReactionPills owns this now).
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    const picker = screen.getByRole('listbox', { name: 'Select reaction' });

    fireEvent.click(within(picker).getByRole('option', { name: 'React with 😂' }));

    expect(onReactionClick).toHaveBeenCalledWith('😂');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
