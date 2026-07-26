import type { ReactNode } from 'react';

export type BannerTone = 'accent' | 'notice' | 'warning';

const toneClasses: Record<BannerTone, string> = {
  accent: 'bg-accent/10 border-accent/20',
  notice: 'bg-accent-tint border-accent-tint-border text-accent-tint-text',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
};

interface BannerProps {
  tone?: BannerTone;
  children: ReactNode;
}

/** Full-width strip below the header, aligned to the main content column. */
export function Banner({ tone = 'accent', children }: BannerProps) {
  return (
    <div className={`border-b ${toneClasses[tone]}`}>
      <div className="max-w-[900px] mx-auto px-6 py-2">{children}</div>
    </div>
  );
}
