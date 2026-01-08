import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function LandingPage() {
  return (
    <div
      className="bg-neutral-50 flex flex-col justify-center items-center px-6"
      style={{ height: '100dvh', overflow: 'hidden' }}
    >
      <div className="w-full text-center" style={{ maxWidth: '500px' }}>
        <div className="mb-4">
          <Logo size="lg" />
        </div>

        <p className="text-lg text-neutral-500 mb-10 leading-relaxed">
          Private photo sharing for families and close friends.
        </p>

        <Link to="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    </div>
  );
}
