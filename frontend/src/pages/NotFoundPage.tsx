import { Logo } from '../components/Logo';
import { ButtonLink } from '../components/Button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg-primary px-6 text-center">
      <Logo size="sm" />
      <h2 className="mt-8 text-6xl font-bold text-text-primary">404</h2>
      <p className="mt-4 text-lg text-text-secondary">This page doesn't exist.</p>
      <ButtonLink to="/" size="lg" className="mt-8">
        Go home
      </ButtonLink>
    </div>
  );
}
