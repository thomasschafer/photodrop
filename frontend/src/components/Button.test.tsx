import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Button, ButtonLink } from './Button';

describe('Button', () => {
  it('uses the primary theme tokens and safe button type by default', () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-accent-solid', 'hover:bg-accent-solid-hover');
  });

  it('applies typed variants, sizes, and additional layout classes', () => {
    render(
      <Button variant="danger" size="sm" className="w-full">
        Delete
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'bg-red-600',
      'px-3',
      'py-1.5',
      'w-full'
    );
  });

  it('shares the same style mapping with router links', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/login" size="lg">
          Sign in
        </ButtonLink>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveClass(
      'bg-accent-solid',
      'px-6',
      'py-3'
    );
  });
});
