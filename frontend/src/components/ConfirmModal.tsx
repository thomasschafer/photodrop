import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../lib/useFocusTrap';
import { Button } from './Button';

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

  useFocusTrap(modalRef);

  useEffect(() => {
    // React applies a child's autoFocus while committing, i.e. before this
    // effect runs. Focusing the confirm button unconditionally would steal
    // focus straight back off that child (e.g. the rename modal's text input,
    // whose confirm button is enabled from the start), so the user's typing
    // would go nowhere.
    if (modalRef.current?.contains(document.activeElement)) return;
    confirmButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

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
            <Button onClick={onDontAskAgain} disabled={isLoading} variant="link" size="bare">
              Don't ask again
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <Button onClick={onCancel} disabled={isLoading} variant="secondary" size="md">
              {cancelLabel}
            </Button>
            <Button
              ref={confirmButtonRef}
              onClick={onConfirm}
              disabled={isLoading || confirmDisabled}
              variant={variant === 'danger' ? 'danger' : 'primary'}
              size="md"
            >
              {isLoading ? <span className="spinner spinner-sm" /> : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
