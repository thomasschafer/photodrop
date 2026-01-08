import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

export function LandingPage() {
  return (
    <div
      style={{
        height: '100dvh',
        overflow: 'hidden',
        backgroundColor: 'var(--color-bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 1.5rem',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
        }}
      >
        <ThemeToggle />
      </div>

      <div className="w-full text-center" style={{ maxWidth: '500px' }}>
        <div className="mb-4">
          <Logo size="lg" />
        </div>

        <p
          style={{
            fontSize: '1.125rem',
            color: 'var(--color-text-secondary)',
            marginBottom: '2.5rem',
            lineHeight: 1.6,
          }}
        >
          Private photo sharing for families and close friends.
        </p>

        <Link to="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    </div>
  );
}
