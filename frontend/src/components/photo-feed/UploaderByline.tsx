import { formatRelativeTime } from '../../lib/dateFormat';
import type { ProfileColor } from '../../lib/profileColors';
import { Avatar } from '../Avatar';

/**
 * `overlay` is for the lightbox, where the byline sits on top of the photo
 * itself and so needs its own contrast rather than the surface colours.
 */
type BylineVariant = 'default' | 'overlay';

interface UploaderBylineProps {
  /** Null is supported for legacy records and is displayed as "Deleted user". */
  name: string | null;
  color: ProfileColor | null;
  uploadedAt: number;
  variant?: BylineVariant;
}

const containerClasses: Record<BylineVariant, string> = {
  default: '',
  overlay: 'rounded-full bg-black/40 backdrop-blur-sm py-1 pr-3 text-white',
};

/**
 * The avatar's own width insets the overlay pill's leading edge, so the pill
 * only needs to supply that inset itself when there is no avatar to render.
 */
const overlayLeftPadding = {
  withAvatar: 'pl-1',
  withoutAvatar: 'pl-3',
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
  const avatar = name && color ? <Avatar name={name} color={color} size="sm" /> : null;
  const padding =
    variant === 'overlay' ? overlayLeftPadding[avatar ? 'withAvatar' : 'withoutAvatar'] : '';

  return (
    <div className={`flex items-center gap-1.5 text-sm ${containerClasses[variant]} ${padding}`}>
      {avatar}
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
