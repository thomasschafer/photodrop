import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

/**
 * The trap must move focus itself on every Tab press, not only when focus
 * sits at the boundary of its focusable list. Safari's default keyboard
 * behaviour never tabs onto buttons, so a trap that waits for focus to reach
 * a boundary *button* before intercepting never fires there: Tab walks out
 * of the dialog into the page behind it, and button-only controls (Cancel,
 * Save) are unreachable. jsdom performs no native tab navigation at all,
 * which makes it a faithful stand-in for "the browser didn't do what you
 * assumed": any focus movement observed here is movement the trap made.
 */
function TrapHarness({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, enabled);
  return (
    <div>
      <button>Outside</button>
      <div ref={ref} role="dialog">
        <button>Close</button>
        <input aria-label="Name" />
        <input aria-label="Display name" />
        <button>Cancel</button>
        <button>Save</button>
      </div>
    </div>
  );
}

function pressTab(shiftKey = false) {
  const target = document.activeElement ?? document;
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('useFocusTrap', () => {
  it('moves focus to the next element on Tab from mid-list', () => {
    render(<TrapHarness />);
    screen.getByLabelText('Name').focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Display name'));
  });

  it('moves focus from an input onto a button on Tab', () => {
    // The precise Safari failure: the element after the last text field is a
    // button, which Safari's native Tab would skip — so the trap must place
    // focus there itself.
    render(<TrapHarness />);
    screen.getByLabelText('Display name').focus();

    pressTab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('moves focus to the previous element on Shift-Tab from mid-list', () => {
    render(<TrapHarness />);
    screen.getByLabelText('Display name').focus();

    const event = pressTab(true);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('wraps from the last element to the first on Tab', () => {
    render(<TrapHarness />);
    screen.getByRole('button', { name: 'Save' }).focus();

    pressTab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('wraps from the first element to the last on Shift-Tab', () => {
    render(<TrapHarness />);
    screen.getByRole('button', { name: 'Close' }).focus();

    pressTab(true);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('pulls focus back into the trap when it sits outside the container', () => {
    render(<TrapHarness />);
    screen.getByRole('button', { name: 'Outside' }).focus();

    pressTab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('visits every control in one full cycle of Tab presses', () => {
    render(<TrapHarness />);
    screen.getByRole('button', { name: 'Close' }).focus();

    const visited = new Set<Element | null>();
    for (let i = 0; i < 5; i++) {
      pressTab();
      visited.add(document.activeElement);
    }

    expect(visited).toEqual(
      new Set([
        screen.getByLabelText('Name'),
        screen.getByLabelText('Display name'),
        screen.getByRole('button', { name: 'Cancel' }),
        screen.getByRole('button', { name: 'Save' }),
        screen.getByRole('button', { name: 'Close' }),
      ])
    );
  });

  it('does not intercept Tab when disabled', () => {
    render(<TrapHarness enabled={false} />);
    const name = screen.getByLabelText('Name');
    name.focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(name);
  });
});
