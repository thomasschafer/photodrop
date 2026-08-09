import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ModalBackdrop } from './ModalBackdrop';

function backdropOf(container: HTMLElement) {
  const backdrop = container.querySelector('[aria-hidden="true"]');
  if (!backdrop) throw new Error('backdrop not rendered');
  return backdrop;
}

describe('ModalBackdrop', () => {
  it('blurs the page behind it by default', () => {
    const { container } = render(<ModalBackdrop onClick={vi.fn()} />);

    expect(backdropOf(container)).toHaveClass('backdrop-blur-[2px]');
  });

  it('drops the blur when a caller opts out', () => {
    const { container } = render(<ModalBackdrop onClick={vi.fn()} blurBackdrop={false} />);

    expect(backdropOf(container)).not.toHaveClass('backdrop-blur-[2px]');
  });

  it('dims further when raised, and still blurs', () => {
    const { container } = render(<ModalBackdrop onClick={vi.fn()} elevation="raised" />);

    expect(backdropOf(container)).toHaveClass('bg-black/60', 'backdrop-blur-[2px]');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const { container } = render(<ModalBackdrop onClick={onClick} />);

    fireEvent.click(backdropOf(container));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
