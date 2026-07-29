import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { ReactionPills } from './ReactionPills';
import { LONG_PRESS_TIMEOUT_MS, type ReactionWithUser } from './types';

describe('ReactionPills', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

    // Real browsers fire mousedown before click, so drive them in that order.
    // fireEvent returns false when the event's default was prevented.
    expect(fireEvent.mouseDown(trigger)).toBe(false);
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'React with 😂' });

    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onReactionClick).toHaveBeenCalledWith('😂');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Reopen, then press the trigger again: because it focuses itself on
    // mousedown (replacing the native focus that preventDefault suppresses),
    // the blur handler sees a relatedTarget inside the container and the
    // second press toggles the picker shut instead of leaving it open.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Select reaction' })).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('abandons a long press on touchcancel instead of firing it unattended', () => {
    // iOS sends touchcancel in place of touchend when it takes the touch over.
    // The pending timer must go with it, or the names tooltip pops up (and a
    // detail fetch runs) with no finger on the screen.
    vi.useFakeTimers();
    const onLoadReactionDetails = vi.fn();

    render(
      <ReactionPills
        reactions={[{ emoji: '🔥', count: 1 }]}
        userReactions={[]}
        onReactionClick={vi.fn()}
        onLoadReactionDetails={onLoadReactionDetails}
        showNames
      />
    );

    const pill = screen.getByLabelText('Add 🔥 reaction');
    fireEvent.touchStart(pill, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchCancel(pill);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_TIMEOUT_MS);
    });

    expect(onLoadReactionDetails).not.toHaveBeenCalled();
  });

  it('does not let a cancelled press swallow the tap that follows it', () => {
    // Cancel part-way through the press, then tap again straight away. If the
    // cancelled press's timer is still armed it fires mid-tap and marks the
    // gesture as a long press, so the click guard eats it and the user's
    // reaction is silently lost.
    vi.useFakeTimers();
    const onReactionClick = vi.fn();

    render(
      <ReactionPills
        reactions={[{ emoji: '🔥', count: 1 }]}
        userReactions={[]}
        onReactionClick={onReactionClick}
        onLoadReactionDetails={vi.fn()}
        showNames
      />
    );

    const pill = screen.getByLabelText('Add 🔥 reaction');
    fireEvent.touchStart(pill, { touches: [{ clientX: 0, clientY: 0 }] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_TIMEOUT_MS - 200);
    });
    fireEvent.touchCancel(pill);

    fireEvent.touchStart(pill, { touches: [{ clientX: 0, clientY: 0 }] });
    act(() => {
      // Past the abandoned press's deadline, but well short of this tap's.
      vi.advanceTimersByTime(300);
    });
    fireEvent.touchEnd(pill);
    fireEvent.click(pill);

    expect(onReactionClick).toHaveBeenCalledWith('🔥');
  });

  it('closes a viewport-positioned picker on scroll rather than leaving it adrift', () => {
    // With useViewportPositioning the picker is placed at fixed coordinates
    // measured against its trigger when it opened, and only recomputed on
    // resize — so scrolling the feed would leave it floating away from the
    // photo it belongs to.
    render(
      <ReactionPills
        reactions={[]}
        userReactions={[]}
        onReactionClick={vi.fn()}
        useViewportPositioning
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    expect(screen.getByRole('listbox', { name: 'Select reaction' })).toBeInTheDocument();

    fireEvent.scroll(document, {});
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps an anchored picker open on scroll', () => {
    // Without viewport positioning the picker is absolutely positioned inside
    // the pill row, so it travels with its trigger and has no reason to close.
    render(<ReactionPills reactions={[]} userReactions={[]} onReactionClick={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    fireEvent.scroll(document, {});

    expect(screen.getByRole('listbox', { name: 'Select reaction' })).toBeInTheDocument();
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
