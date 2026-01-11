import { useState, useRef } from 'react';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { Modal } from './Modal';

// Small button for header - shows when dismissed, allows re-showing the prompt
export function InstallButton() {
  const { platform, isInstalled, isDismissed, canSkipInstall, dismiss } = useInstallPrompt();
  const [showInstructions, setShowInstructions] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Don't show if installed, not dismissed, or Firefox (can skip install)
  if (isInstalled || !isDismissed || canSkipInstall) {
    return null;
  }

  const handleClose = () => {
    setShowInstructions(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setShowInstructions(true)}
        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-secondary transition-colors cursor-pointer"
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
            <button
              onClick={() => {
                dismiss(true);
                setShowInstructions(false);
              }}
              className="btn-link"
            >
              Don't show again
            </button>
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
      const installed = await triggerNativePrompt();
      if (installed) {
        onInstalled?.();
      }
    } else {
      setShowInstructions(true);
    }
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
      <div className="bg-accent/10 border-b border-accent/20">
        <div className="max-w-[900px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                You can use photodrop directly in your browser - no installation needed.
              </p>
            </div>
            <button onClick={handleSkip} className="btn-text shrink-0">
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showInstructions && (
        <Modal title="Install photodrop" onClose={() => setShowInstructions(false)} maxWidth="md">
          <PlatformInstructions platform={platform} />
          <div className="mt-4">
            <button
              onClick={() => handleDismiss(true)}
              className="btn-link"
            >
              Don't show again
            </button>
          </div>
        </Modal>
      )}
      <div className="bg-accent/10 border-b border-accent/20">
        <div className="max-w-[900px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                <span className="font-medium">Install photodrop</span>
                <span className="text-text-secondary"> for easy access and notifications</span>
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <button onClick={() => handleDismiss(true)} className="btn-link text-sm">
                Don't show again
              </button>
              <button onClick={() => handleDismiss(false)} className="btn-secondary-sm">
                Later
              </button>
              <button onClick={handleInstallClick} className="btn-primary-sm">
                Install
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
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
              <ShareIcon className="inline-block w-4 h-4 align-text-bottom" /> at the bottom of
              Safari
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
          <p className="text-xs text-text-tertiary">
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
              Tap the <strong>menu</strong> button{' '}
              <MenuIcon className="inline-block w-4 h-4 align-text-bottom" /> in Chrome
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
          <p className="text-xs text-text-tertiary">
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
