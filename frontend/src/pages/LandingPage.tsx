import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

export function LandingPage() {
  return (
    <div className="h-dvh overflow-hidden bg-bg-primary flex flex-col justify-center items-center px-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[500px] text-center">
        <div className="mb-4">
          <Logo size="lg" />
        </div>

        <p className="text-lg text-text-secondary mb-10 leading-relaxed">
          Private photo sharing for families and close friends.
        </p>

        <Link to="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    </div>
  );
}
