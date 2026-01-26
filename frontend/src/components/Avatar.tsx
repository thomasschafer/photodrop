import { getInitials, type ProfileColor } from '../lib/profileColors';

interface AvatarProps {
  name: string;
  color: ProfileColor;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-sm',
} as const;

export function Avatar({ name, color, size = 'md' }: AvatarProps) {
  const initials = getInitials(name);

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 select-none`}
      style={{ backgroundColor: `var(--profile-${color})` }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
