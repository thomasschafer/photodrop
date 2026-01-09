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
  return (
    <Link to="/" className="block text-center no-underline transition-opacity hover:opacity-70">
      <h1 className={`${sizeClasses[size]} font-semibold text-text-primary tracking-tight m-0`}>
        photodrop
      </h1>
    </Link>
  );
}
