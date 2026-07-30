/**
 * Lets code that just changed something feed-visible (a profile rename, a
 * display-name or color change) tell a mounted PhotoFeed to re-sync from the
 * server immediately, instead of waiting for the next freshness poll. The
 * feed's polling only fingerprints content (photos/comments/reactions), so
 * profile edits would otherwise stay stale until reload.
 */

type FeedRefreshListener = () => void;

const listeners = new Set<FeedRefreshListener>();

export function subscribeFeedRefresh(listener: FeedRefreshListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyFeedRefresh(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
