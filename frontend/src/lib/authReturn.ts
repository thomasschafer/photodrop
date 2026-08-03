import { setLocalStorageItem } from './storage';

const RETURN_PATH_KEY = 'photodrop:auth-return-path';
const RETURN_PATH_MAX_AGE_MS = 60 * 60 * 1000;

interface StoredReturnPath {
  path: string;
  savedAt: number;
}

export function rememberAuthReturnPath(path: string): void {
  if (!path.startsWith('/photo/')) return;
  setLocalStorageItem(
    RETURN_PATH_KEY,
    JSON.stringify({ path, savedAt: Date.now() } satisfies StoredReturnPath)
  );
}

export function consumeAuthReturnPath(): string {
  let stored: string | null;
  try {
    stored = localStorage.getItem(RETURN_PATH_KEY);
    localStorage.removeItem(RETURN_PATH_KEY);
  } catch {
    return '/';
  }
  if (!stored) return '/';

  try {
    const { path, savedAt } = JSON.parse(stored) as Partial<StoredReturnPath>;
    return typeof path === 'string' &&
      path.startsWith('/photo/') &&
      typeof savedAt === 'number' &&
      Date.now() - savedAt <= RETURN_PATH_MAX_AGE_MS
      ? path
      : '/';
  } catch {
    return '/';
  }
}
