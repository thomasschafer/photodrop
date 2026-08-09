import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

// setTheme is captured and called directly rather than through a click: a DOM
// event dispatch swallows a throw from the handler, which would let a regression
// here pass unnoticed.
const setThemeRef: { current: ((theme: 'system' | 'light' | 'dark') => void) | null } = {
  current: null,
};

function Consumer() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  useEffect(() => {
    setThemeRef.current = setTheme;
  }, [setTheme]);
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('persists the chosen theme', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    );

    act(() => {
      setThemeRef.current!('dark');
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('applies the theme even when localStorage refuses the write', () => {
    // Restricted storage must not throw out of the theme toggle's click
    // handler; the theme still applies, it just doesn't survive a reload.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    );

    act(() => {
      setThemeRef.current!('dark');
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});
