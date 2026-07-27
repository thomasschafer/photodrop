// Deep-link delivery between the Capacitor listeners (registered at module
// scope in main.tsx) and the router (subscribed from a passive effect in App).
//
// The two are unordered: on a cold start CapApp.getLaunchUrl() can resolve
// before React has mounted, so dispatching an event at that point sends it
// nowhere and the notification tap / magic link silently opens the app at `/`.
// Publishing through here buffers the path until the first subscriber arrives.

type DeepLinkHandler = (path: string) => void;

const handlers = new Set<DeepLinkHandler>();

// At most one link can be pending: a newer launch/open URL supersedes an older
// one that was never consumed.
let pendingPath: string | null = null;

/**
 * Parse a deep-link URL into the app path to navigate to, or null if the URL is
 * unusable. Capacitor hands us whatever the OS passed, so a malformed value
 * must not throw out of the listener — that would take down every later deep
 * link registered on the same handle.
 */
export function deepLinkPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    console.error('Ignoring deep link with an unparseable URL:', url);
    return null;
  }
}

export function publishDeepLink(path: string): void {
  if (handlers.size === 0) {
    pendingPath = path;
    return;
  }
  for (const handler of handlers) {
    handler(path);
  }
}

export function subscribeToDeepLinks(handler: DeepLinkHandler): () => void {
  handlers.add(handler);

  // Replay a link that arrived before anyone was listening, exactly once — a
  // later remount must not navigate the user back to a link already followed.
  if (pendingPath !== null) {
    const path = pendingPath;
    pendingPath = null;
    handler(path);
  }

  return () => {
    handlers.delete(handler);
  };
}
