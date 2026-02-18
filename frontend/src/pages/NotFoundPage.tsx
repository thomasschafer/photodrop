import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg-primary px-6 text-center">
      <Logo size="sm" />
      <h2 className="mt-8 text-6xl font-bold text-text-primary">404</h2>
      <p className="mt-4 text-lg text-text-secondary">This page doesn't exist.</p>
      <Link
        to="/"
        className="mt-8 px-6 py-3 bg-accent text-white rounded-lg font-medium no-underline hover:opacity-90 transition-opacity"
      >
        Go home
      </Link>
    </div>
  );
}
