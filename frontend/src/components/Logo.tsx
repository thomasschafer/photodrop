import { Link } from 'react-router-dom';

type LogoSize = 'sm' | 'md' | 'lg';

interface LogoProps {
  size?: LogoSize;
}

const sizeStyles: Record<LogoSize, string> = {
  sm: '1.25rem',
  md: '1.5rem',
  lg: '2.25rem',
};

export function Logo({ size = 'md' }: LogoProps) {
  return (
    <Link
      to="/"
      style={{
        display: 'block',
        textAlign: 'center',
        textDecoration: 'none',
      }}
    >
      <h1
        style={{
          fontSize: sizeStyles[size],
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.025em',
          margin: 0,
        }}
      >
        photodrop
      </h1>
    </Link>
  );
}
