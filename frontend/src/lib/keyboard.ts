export type NavDirection = 'up' | 'down' | 'left' | 'right';

interface KeyboardEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * Maps keyboard keys to navigation directions.
 * Supports both arrow keys and vim-style hjkl keys.
 * Returns null if any modifier key (Cmd, Ctrl, Alt) is pressed to avoid
 * interfering with browser shortcuts like Cmd+L.
 */
export function getNavDirection(event: KeyboardEventLike): NavDirection | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  switch (event.key) {
    case 'ArrowUp':
    case 'k':
      return 'up';
    case 'ArrowDown':
    case 'j':
      return 'down';
    case 'ArrowLeft':
    case 'h':
      return 'left';
    case 'ArrowRight':
    case 'l':
      return 'right';
    default:
      return null;
  }
}

/**
 * Checks if a key is a vertical navigation key (up/down).
 */
export function isVerticalNavKey(event: KeyboardEventLike): boolean {
  const dir = getNavDirection(event);
  return dir === 'up' || dir === 'down';
}

/**
 * Checks if a key is a horizontal navigation key (left/right).
 */
export function isHorizontalNavKey(event: KeyboardEventLike): boolean {
  const dir = getNavDirection(event);
  return dir === 'left' || dir === 'right';
}
