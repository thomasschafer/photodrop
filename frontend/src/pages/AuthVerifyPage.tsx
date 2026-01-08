import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';

type VerifyStatus = 'verifying' | 'success' | 'error';

export function AuthVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<VerifyStatus>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const verificationAttempted = useRef(false);

  useEffect(() => {
    if (!token || verificationAttempted.current) {
      return;
    }

    verificationAttempted.current = true;

    const verifyToken = async () => {
      try {
        const data = await api.auth.verifyMagicLink(token);

        login(data.accessToken, {
          id: data.user.id,
          name: data.user.name,
          role: data.user.role,
        });

        setStatus('success');

        setTimeout(() => {
          navigate('/', { replace: true });
        }, 1500);
      } catch (error) {
        console.error('Failed to verify magic link:', error);
        setStatus('error');

        if (error instanceof ApiError) {
          if (error.message.includes('expired')) {
            setErrorMessage('This link has expired. Please request a new one.');
          } else if (error.message.includes('already been used')) {
            setErrorMessage('This link has already been used. Please request a new one.');
          } else {
            setErrorMessage(error.message || 'Invalid or expired link.');
          }
        } else {
          setErrorMessage('Something went wrong. Please try again.');
        }
      }
    };

    verifyToken();
  }, [token, login, navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
      }}
    >
      <div className="w-full mx-auto" style={{ maxWidth: '440px' }}>
        <div className="mb-8">
          <Logo />
        </div>

        <div className="card text-center">
          {!token ? (
            <ErrorContent message="Invalid link. No token provided." />
          ) : status === 'verifying' ? (
            <VerifyingContent />
          ) : status === 'success' ? (
            <SuccessContent />
          ) : (
            <ErrorContent message={errorMessage} />
          )}
        </div>
      </div>
    </div>
  );
}

function VerifyingContent() {
  return (
    <>
      <div className="flex justify-center mb-4">
        <div className="spinner" />
      </div>
      <p style={{ color: 'var(--color-text-secondary)' }}>Verifying your link...</p>
    </>
  );
}

function SuccessContent() {
  return (
    <>
      <div
        style={{
          width: '3rem',
          height: '3rem',
          margin: '0 auto 1rem',
          borderRadius: '50%',
          backgroundColor: 'var(--color-accent-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          style={{ color: 'var(--color-accent)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2
        style={{
          fontSize: '1.125rem',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: '0.5rem',
        }}
      >
        You're signed in
      </h2>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Redirecting...</p>
    </>
  );
}

function ErrorContent({ message }: { message: string }) {
  return (
    <>
      <div
        style={{
          width: '3rem',
          height: '3rem',
          margin: '0 auto 1rem',
          borderRadius: '50%',
          backgroundColor: 'rgba(196, 84, 84, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          style={{ color: 'var(--color-error)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <h2
        style={{
          fontSize: '1.125rem',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: '0.5rem',
        }}
      >
        Link not valid
      </h2>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--color-text-secondary)',
          marginBottom: '1.5rem',
        }}
      >
        {message}
      </p>
      <Link to="/login" className="btn-primary">
        Request a new link
      </Link>
    </>
  );
}
