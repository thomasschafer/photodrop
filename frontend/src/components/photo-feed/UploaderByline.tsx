import { formatRelativeTime } from '../../lib/dateFormat';
import type { ProfileColor } from '../../lib/profileColors';
import { Avatar } from '../Avatar';

/**
 * `overlay` is for the lightbox, where the byline sits on top of the photo
 * itself and so needs its own contrast rather than the surface colours.
 */
type BylineVariant = 'default' | 'overlay';

interface UploaderBylineProps {
  /** Null once the uploader's account has been deleted. */
  name: string | null;
  color: ProfileColor | null;
  uploadedAt: number;
  variant?: BylineVariant;
}

const containerClasses: Record<BylineVariant, string> = {
  default: '',
  overlay: 'rounded-full bg-black/40 backdrop-blur-sm py-1 pl-1 pr-3 text-white',
};

const nameClasses: Record<BylineVariant, string> = {
  default: 'font-medium text-text-primary',
  overlay: 'font-medium',
};

const timeClasses: Record<BylineVariant, string> = {
  default: 'text-text-muted',
  overlay: 'text-white/70',
};

export function UploaderByline({
  name,
  color,
  uploadedAt,
  variant = 'default',
}: UploaderBylineProps) {
  return (
    <div className={`flex items-center gap-1.5 text-sm ${containerClasses[variant]}`}>
      {name && color ? (
        <Avatar name={name} color={color} size="sm" />
      ) : (
        // Keeps the text aligned with bylines that do have an avatar.
        <span className={variant === 'overlay' ? 'w-1' : 'w-0'} aria-hidden="true" />
      )}
      <span className={name ? nameClasses[variant] : timeClasses[variant]}>
        {name ?? 'Deleted user'}
      </span>
      <span className={timeClasses[variant]} aria-hidden="true">
        ·
      </span>
      <span className={timeClasses[variant]}>{formatRelativeTime(uploadedAt)}</span>
    </div>
  );
}
