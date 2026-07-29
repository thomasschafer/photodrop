import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { SwUpdatePrompt } from './SwUpdatePrompt';

interface FakeRegistration {
  waiting: ServiceWorker | null;
  update: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function makeRegistration(waiting: ServiceWorker | null = null): FakeRegistration {
  return {
    waiting,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// jsdom has no navigator.serviceWorker; install one whose getRegistration we
// can hold open to exercise the unmount-mid-lookup race.
function installServiceWorker(getRegistration: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: {},
    },
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

describe('SwUpdatePrompt', () => {
  beforeEach(() => {
    setVisibility('visible');
  });

  afterEach(() => {
    // Unmount before tearing down the fake serviceWorker: the component's
    // cleanup reads it.
    cleanup();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(document, 'visibilityState');
    vi.restoreAllMocks();
  });

  it('shows the prompt when a worker is already waiting', async () => {
    const registration = makeRegistration({} as ServiceWorker);
    installServiceWorker(async () => registration);

    render(<SwUpdatePrompt />);

    expect(await screen.findByText('A new version is available!')).toBeInTheDocument();
  });

  it('checks for a new worker whenever the app returns to the foreground', async () => {
    // An installed iOS PWA is resumed far more often than it is navigated, so
    // without this it can miss a deploy for days.
    const registration = makeRegistration();
    installServiceWorker(async () => registration);

    render(<SwUpdatePrompt />);
    await waitFor(() => expect(registration.addEventListener).toHaveBeenCalled());

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(registration.update).toHaveBeenCalledTimes(1);

    // Backgrounding is not a reason to check.
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not attach updatefound when unmounted before getRegistration resolves', async () => {
    // The listener is attached to an object that outlives the component, so
    // attaching after cleanup leaks it with nothing left to remove it.
    let resolveRegistration!: (registration: FakeRegistration) => void;
    const registration = makeRegistration();
    installServiceWorker(
      () =>
        new Promise((resolve) => {
          resolveRegistration = resolve as (registration: FakeRegistration) => void;
        })
    );

    const { unmount } = render(<SwUpdatePrompt />);
    unmount();

    await act(async () => {
      resolveRegistration(registration);
      await Promise.resolve();
    });

    expect(registration.addEventListener).not.toHaveBeenCalled();
  });
});
