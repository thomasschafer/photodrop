import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../lib/useFocusTrap';
import { ModalBackdrop, type ModalElevation } from './ModalBackdrop';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidth?: 'sm' | 'md' | 'lg';
  elevation?: ModalElevation;
  blurBackdrop?: boolean;
}

const panelShadowClasses: Record<ModalElevation, string> = {
  default: 'shadow-elevated',
  raised: 'shadow-modal',
};

export function Modal({
  title,
  children,
  onClose,
  maxWidth = 'sm',
  elevation = 'default',
  blurBackdrop = true,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(modalRef);

  useEffect(() => {
    // React applies a child's autoFocus while committing, i.e. before this
    // effect runs. Focusing the close button unconditionally would steal focus
    // straight back off that child, so a modal that opens on a form field would
    // send the user's typing nowhere. (The close button is the panel's first
    // focusable element, so this is also where the trap would enter.)
    if (modalRef.current?.contains(document.activeElement)) return;
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }[maxWidth];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <ModalBackdrop onClick={onClose} elevation={elevation} blurBackdrop={blurBackdrop} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative bg-surface rounded-xl ${panelShadowClasses[elevation]} p-6 ${maxWidthClass} w-full mx-4 border border-border`}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="modal-title" className="text-lg font-medium text-text-primary">
            {title}
          </h3>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2.5 -m-1.5 text-text-muted hover:text-text-primary transition-colors cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
