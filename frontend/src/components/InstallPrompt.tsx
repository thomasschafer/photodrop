import { useState } from 'react';
import { useFocusRestore } from '../lib/hooks';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { Banner } from './Banner';
import { Modal } from './Modal';
import { Button } from './Button';

// Small button for header - shows when dismissed, allows re-showing the prompt
export function InstallButton() {
  const {
    platform,
    isInstalled,
    isDismissed,
    canSkipInstall,
    canPromptNatively,
    triggerNativePrompt,
    dismiss,
  } = useInstallPrompt();
  const [showInstructions, setShowInstructions] = useState(false);
  const [buttonRef, restoreFocus] = useFocusRestore<HTMLButtonElement>();

  // Don't show if installed, not dismissed, or Firefox (can skip install)
  if (isInstalled || !isDismissed || canSkipInstall) {
    return null;
  }

  const handleClose = () => {
    setShowInstructions(false);
    restoreFocus();
  };

  const handleOpen = async () => {
    if (canPromptNatively) {
      const result = await triggerNativePrompt();
      if (result === 'accepted') return;
    }
    setShowInstructions(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors cursor-pointer min-w-[44px] min-h-[44px]"
        aria-label="Install app"
        title="Install app"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v13" />
          <polyline points="8,11 12,15 16,11" />
          <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
      </button>
      {showInstructions && (
        <Modal title="Install photodrop" onClose={handleClose} maxWidth="md">
          <PlatformInstructions platform={platform} />
          <div className="mt-4">
            <Button
              onClick={() => {
                dismiss(true);
                setShowInstructions(false);
              }}
              variant="link"
              size="bare"
            >
              Don't show again
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

interface InstallPromptProps {
  onDismiss?: () => void;
  onInstalled?: () => void;
}

export function InstallPrompt({ onDismiss, onInstalled }: InstallPromptProps) {
  const {
    platform,
    shouldShowPrompt,
    canPromptNatively,
    canSkipInstall,
    triggerNativePrompt,
    dismiss,
  } = useInstallPrompt();

  const [showInstructions, setShowInstructions] = useState(false);

  if (!shouldShowPrompt) {
    return null;
  }

  const handleInstallClick = async () => {
    if (canPromptNatively) {
      const result = await triggerNativePrompt();
      if (result === 'accepted') {
        onInstalled?.();
      } else if (result === 'error' || result === 'unavailable') {
        setShowInstructions(true);
      }
    } else {
      setShowInstructions(true);
    }
  };

  // Returns to the install popup, which takes focus again as it remounts.
  const handleInstructionsClose = () => {
    setShowInstructions(false);
  };

  const handleDismiss = (permanently: boolean) => {
    dismiss(permanently);
    onDismiss?.();
  };

  const handleSkip = () => {
    dismiss(true);
    onDismiss?.();
  };

  // Firefox can skip install entirely - notifications work in browser
  if (canSkipInstall) {
    return (
      <Banner>
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary">
              You can use photodrop directly in your browser - no installation needed.
            </p>
          </div>
          <Button onClick={handleSkip} variant="text" size="inline" className="shrink-0">
            Got it
          </Button>
        </div>
      </Banner>
    );
  }

  // The instructions replace the prompt rather than stacking on top of it, so
  // only one dialog is ever open.
  if (showInstructions) {
    return (
      <Modal
        title="Install photodrop"
        onClose={handleInstructionsClose}
        maxWidth="md"
        elevation="raised"
      >
        <PlatformInstructions platform={platform} />
        <div className="mt-4">
          <Button onClick={() => handleDismiss(true)} variant="link" size="bare">
            Don't show again
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Install photodrop"
      onClose={() => handleDismiss(false)}
      maxWidth="sm"
      elevation="raised"
    >
      <p className="text-sm text-text-secondary">
        Add photodrop to your home screen for easy access and notifications.
      </p>
      <div className="mt-6 flex flex-col mobile:flex-row mobile:items-center mobile:justify-between gap-4">
        <Button onClick={() => handleDismiss(true)} variant="link" size="bare">
          Don't show again
        </Button>
        <div className="flex items-center justify-end gap-3">
          <Button onClick={() => handleDismiss(false)} variant="secondary" size="sm">
            Later
          </Button>
          <Button onClick={handleInstallClick} size="sm">
            Install
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PlatformInstructions({ platform }: { platform: string }) {
  switch (platform) {
    case 'ios':
      return (
        <div className="text-sm text-text-secondary space-y-2">
          <p>To install on your iPhone or iPad:</p>
          <ol className="list-decimal list-inside space-y-1 pl-1">
            <li>
              Tap the <strong>Share</strong> button{' '}
              <ShareIcon className="inline-block w-4 h-4 align-text-bottom" /> at the bottom of your
              browser
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>
            </li>
            <li>
              Tap <strong>Add</strong> in the top right
            </li>
          </ol>
        </div>
      );

    case 'macos-safari':
      return (
        <div className="text-sm text-text-secondary space-y-2">
          <p>To install on your Mac:</p>
          <ol className="list-decimal list-inside space-y-1 pl-1">
            <li>
              Click <strong>File</strong> in the menu bar
            </li>
            <li>
              Click <strong>Add to Dock</strong>
            </li>
          </ol>
          <p className="text-xs text-text-muted">
            Or click the Share button and select "Add to Dock"
          </p>
        </div>
      );

    case 'android':
      return (
        <div className="text-sm text-text-secondary space-y-2">
          <p>To install on your Android device:</p>
          <ol className="list-decimal list-inside space-y-1 pl-1">
            <li>
              Open your browser’s <strong>menu</strong>{' '}
              <MenuIcon className="inline-block w-4 h-4 align-text-bottom" />
            </li>
            <li>
              Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>
            </li>
            <li>
              Tap <strong>Install</strong>
            </li>
          </ol>
        </div>
      );

    case 'desktop':
    default:
      return (
        <div className="text-sm text-text-secondary space-y-2">
          <p>To install on your computer:</p>
          <ol className="list-decimal list-inside space-y-1 pl-1">
            <li>
              Look for the <strong>install icon</strong>{' '}
              <InstallIcon className="inline-block w-4 h-4 align-text-bottom" /> in the address bar
            </li>
            <li>
              Click <strong>Install</strong>
            </li>
          </ol>
          <p className="text-xs text-text-muted">
            The install icon appears on the right side of the address bar in Chrome or Edge
          </p>
        </div>
      );
  }
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16,6 12,2 8,6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function InstallIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      {/* Monitor screen with notch cut out at top right */}
      <path d="M4 3h10 M22 12v3a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2" />
      {/* Monitor base */}
      <path d="M12 17v3" />
      <path d="M8 20h8" />
      {/* Download arrow in the notch */}
      <path d="M19 2v8" />
      <polyline points="16,7 19,10 22,7" />
    </svg>
  );
}
