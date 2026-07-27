// Best-effort localStorage write. Storage can be unavailable or full (private
// browsing, restricted webviews, quota pressure), and the values persisted
// through here are conveniences (dismissal flags, theme, push deletion tokens)
// — never worth breaking the calling flow over. The read sides already treat a
// missing value as the default, so we log the failure loudly and move on.
export function setLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`Failed to persist "${key}" to localStorage:`, error);
  }
}
