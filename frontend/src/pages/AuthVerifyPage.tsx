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

        // Login with the new multi-group format
        login(
          data.accessToken,
          {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
          },
          data.currentGroup || null,
          data.groups || [],
          data.needsGroupSelection || false
        );

        setStatus('success');

        setTimeout(() => {
          // If user needs to select a group, they'll be redirected by App.tsx
          // based on the needsGroupSelection state
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
    <div className="min-h-screen bg-bg-primary flex flex-col justify-center py-12 px-6">
      <div className="w-full max-w-[440px] mx-auto">
        <div className="mb-4">
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
      <p className="text-text-secondary">Verifying your link...</p>
    </>
  );
}

function SuccessContent() {
  return (
    <>
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-light flex items-center justify-center">
        <svg
          width="24"
          height="24"
          className="text-accent"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-medium text-text-primary mb-2">You're signed in</h2>
      <p className="text-sm text-text-secondary">Redirecting...</p>
    </>
  );
}

function ErrorContent({ message }: { message: string }) {
  return (
    <>
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-error/10 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          className="text-error"
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
      <h2 className="text-lg font-medium text-text-primary mb-2">Link not valid</h2>
      <p className="text-sm text-text-secondary mb-6">{message}</p>
      <Link to="/login" className="btn-primary">
        Request a new link
      </Link>
    </>
  );
}
