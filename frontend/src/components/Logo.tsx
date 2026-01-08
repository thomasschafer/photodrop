import { Link } from 'react-router-dom';

type LogoSize = 'sm' | 'md' | 'lg';

interface LogoProps {
  size?: LogoSize;
}

const sizeClasses: Record<LogoSize, string> = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-4xl',
};

export function Logo({ size = 'md' }: LogoProps) {
  const textClasses = `${sizeClasses[size]} font-semibold text-neutral-800 tracking-tight`;

  return (
    <Link to="/" className="block text-center no-underline hover:no-underline text-inherit">
      <h1 className={textClasses}>photodrop</h1>
    </Link>
  );
}
