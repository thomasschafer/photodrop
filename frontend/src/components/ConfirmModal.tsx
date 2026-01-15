import { useEffect, useRef, useCallback } from 'react';

interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  variant?: 'default' | 'danger';
  confirmDisabled?: boolean;
  children?: React.ReactNode;
  showDontAskAgain?: boolean;
  onDontAskAgain?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isLoading = false,
  variant = 'default',
  confirmDisabled = false,
  children,
  showDontAskAgain = false,
  onDontAskAgain,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const getFocusableElements = useCallback(() => {
    if (!modalRef.current) return [];
    return Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }, []);

  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = getFocusableElements();
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, getFocusableElements]);

  const confirmButtonClasses =
    variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative bg-surface rounded-xl shadow-elevated p-6 max-w-sm w-full mx-4 border border-border"
      >
        <h3 id="confirm-modal-title" className="text-lg font-medium text-text-primary mb-2">
          {title}
        </h3>
        <div className="text-sm text-text-secondary mb-4">{message}</div>
        {children && <div className="mb-4">{children}</div>}
        <div className="flex items-center justify-between gap-3">
          {showDontAskAgain && onDontAskAgain ? (
            <button
              onClick={onDontAskAgain}
              disabled={isLoading}
              className="text-sm text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50 cursor-pointer"
            >
              Don't ask again
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <button
              ref={cancelButtonRef}
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmButtonRef}
              onClick={onConfirm}
              disabled={isLoading || confirmDisabled}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer ${confirmButtonClasses}`}
            >
              {isLoading ? <span className="spinner spinner-sm" /> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
