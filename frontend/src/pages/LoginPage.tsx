import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setErrorMessage('Please enter your email address');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      await api.auth.sendLoginLink(email.trim());
      setStatus('success');
    } catch (error) {
      console.error('Failed to send login link:', error);
      setErrorMessage('Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-neutral-50">
        <div className="text-center px-6 max-w-md">
          <h1 className="text-5xl font-black text-primary-600 mb-4 tracking-tight">photodrop</h1>
          <div className="card">
            <div className="text-4xl mb-4" aria-hidden="true">
              ✉️
            </div>
            <h2 className="text-xl font-bold text-neutral-800 mb-2">Check your email</h2>
            <p className="text-neutral-600">
              If <strong className="text-neutral-800">{email}</strong> has an account, we've sent a
              login link.
            </p>
            <p className="text-sm text-neutral-500 mt-4">
              The link expires in 15 minutes. Check your spam folder if you don't see it.
            </p>
            <p className="text-sm text-neutral-500 mt-2">
              No email? You may need an invite from your group admin first.
            </p>
            <button
              onClick={() => {
                setStatus('idle');
                setEmail('');
              }}
              className="btn-text mt-6 text-sm"
            >
              Try a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-neutral-50">
      <div className="text-center px-6 w-full max-w-md">
        <h1 className="text-5xl font-black text-primary-600 mb-4 tracking-tight">photodrop</h1>
        <p className="text-xl text-neutral-700 mb-8 font-medium">
          Private photo sharing for your group
        </p>

        <div className="card">
          <h2 className="text-lg font-bold text-neutral-800 mb-6">Log in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-left">
              <label htmlFor="email" className="block text-sm font-medium text-neutral-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input-field w-full"
                disabled={status === 'loading'}
                autoComplete="email"
                autoFocus
                aria-describedby={status === 'error' ? 'email-error' : undefined}
              />
            </div>

            {status === 'error' && (
              <p id="email-error" className="text-sm text-red-600" role="alert">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="btn-primary w-full"
              aria-busy={status === 'loading'}
            >
              {status === 'loading' ? 'Sending...' : 'Send login link'}
            </button>
          </form>

          <p className="text-sm text-neutral-500 mt-6">
            Don't have an account? Ask your group admin for an invite.
          </p>
        </div>
      </div>
    </div>
  );
}
