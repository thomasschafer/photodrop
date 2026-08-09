import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Modal } from './Modal';

function backdropOf(container: HTMLElement) {
  const backdrop = container.querySelector('[aria-hidden="true"]');
  if (!backdrop) throw new Error('backdrop not rendered');
  return backdrop;
}

describe('Modal', () => {
  it('blurs the backdrop without the caller asking', () => {
    const { container } = render(
      <Modal title="Invite someone" onClose={vi.fn()}>
        <p>body</p>
      </Modal>
    );

    expect(backdropOf(container)).toHaveClass('backdrop-blur-[2px]');
  });

  it('threads an opt-out through to the backdrop', () => {
    const { container } = render(
      <Modal title="Invite someone" onClose={vi.fn()} blurBackdrop={false}>
        <p>body</p>
      </Modal>
    );

    expect(backdropOf(container)).not.toHaveClass('backdrop-blur-[2px]');
  });
});
