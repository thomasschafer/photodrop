import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';

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

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-center px-6 py-12">
      <div className="w-full mx-auto" style={{ maxWidth: '440px' }}>
        <div className="mb-8">
          <Logo />
        </div>

        {status === 'success' ? (
          <SuccessState
            email={email}
            onReset={() => {
              setStatus('idle');
              setEmail('');
            }}
          />
        ) : (
          <LoginForm
            email={email}
            setEmail={setEmail}
            status={status}
            errorMessage={errorMessage}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

function LoginForm({
  email,
  setEmail,
  status,
  errorMessage,
  onSubmit,
}: {
  email: string;
  setEmail: (email: string) => void;
  status: 'idle' | 'loading' | 'error';
  errorMessage: string;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <div className="card">
      <h2 className="text-lg font-medium text-neutral-800 mb-1">Sign in</h2>
      <p className="text-sm text-neutral-500 mb-6">Enter your email to receive a sign-in link</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="text-sm font-medium text-neutral-700"
            style={{ display: 'block', marginBottom: '0.3rem' }}
          >
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input-field"
            disabled={status === 'loading'}
            autoComplete="email"
            autoFocus
          />
        </div>

        {status === 'error' && (
          <p className="text-sm text-red-600" role="alert">
            {errorMessage}
          </p>
        )}

        <div style={{ paddingTop: '0.5rem' }}>
          <button type="submit" disabled={status === 'loading'} className="btn-primary w-full">
            {status === 'loading' ? (
              <span className="flex items-center gap-2">
                <span className="spinner spinner-sm" />
                Sending...
              </span>
            ) : (
              'Send sign-in link'
            )}
          </button>
        </div>
      </form>

      <p className="text-sm text-neutral-500 mt-6 text-center">
        Don't have an account? Ask your group admin for an invite.
      </p>
    </div>
  );
}

function SuccessState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="card text-center">
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-100 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          className="text-accent-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>

      <h2 className="text-lg font-medium text-neutral-800 mb-2">Check your email</h2>
      <p className="text-sm text-neutral-600 mb-4">
        If <strong className="text-neutral-800">{email}</strong> has an account, we've sent a
        sign-in link.
      </p>

      <p className="text-sm text-neutral-500 mb-6">
        The link expires in 15 minutes. Check spam if you don't see it.
      </p>

      <button onClick={onReset} className="btn-text">
        Try a different email
      </button>
    </div>
  );
}
