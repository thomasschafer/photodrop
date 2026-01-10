export type NavDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Maps keyboard keys to navigation directions.
 * Supports both arrow keys and vim-style hjkl keys.
 */
export function getNavDirection(key: string): NavDirection | null {
  switch (key) {
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
export function isVerticalNavKey(key: string): boolean {
  const dir = getNavDirection(key);
  return dir === 'up' || dir === 'down';
}

/**
 * Checks if a key is a horizontal navigation key (left/right).
 */
export function isHorizontalNavKey(key: string): boolean {
  const dir = getNavDirection(key);
  return dir === 'left' || dir === 'right';
}
