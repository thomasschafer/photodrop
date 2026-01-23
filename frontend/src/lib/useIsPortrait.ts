import { useState, useEffect } from 'react';

export function useIsPortrait(): boolean {
  const [isPortrait, setIsPortrait] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: portrait)');
    const handleChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isPortrait;
}
