import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

function backdropOf(container: HTMLElement) {
  const backdrop = container.querySelector('[aria-hidden="true"]');
  if (!backdrop) throw new Error('backdrop not rendered');
  return backdrop;
}

describe('ConfirmModal', () => {
  it('blurs the backdrop without the caller asking', () => {
    const { container } = render(
      <ConfirmModal title="Delete photo" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(backdropOf(container)).toHaveClass('backdrop-blur-[2px]');
  });

  it('threads an opt-out through to the backdrop', () => {
    const { container } = render(
      <ConfirmModal
        title="Delete photo"
        message="Sure?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        blurBackdrop={false}
      />
    );

    expect(backdropOf(container)).not.toHaveClass('backdrop-blur-[2px]');
  });

  it('leaves focus on an autofocused child instead of grabbing it', () => {
    // React applies a child's autoFocus during commit, i.e. before the modal's
    // own mount effect runs. The rename modal renders exactly this — an
    // autoFocus input alongside an enabled confirm button — and if the button
    // takes focus back, everything the admin types goes nowhere.
    render(
      <ConfirmModal title="Edit name" message="" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <input aria-label="Name" autoFocus defaultValue="Ada" />
      </ConfirmModal>
    );

    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('focuses the confirm button when nothing inside claims focus', () => {
    render(
      <ConfirmModal title="Delete photo" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  it('keeps Tab inside the dialog', () => {
    render(
      <>
        <button>behind the modal</button>
        <ConfirmModal title="Delete photo" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>
    );

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(confirm).toHaveFocus();

    // Confirm is the last focusable in the dialog, so Tab wraps to the first
    // rather than escaping to the button behind.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });
});
