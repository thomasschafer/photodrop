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
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-center px-6 py-12">
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
      <p className="text-neutral-600">Verifying your link...</p>
    </>
  );
}

function SuccessContent() {
  return (
    <>
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-100 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          className="text-accent-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-medium text-neutral-800 mb-2">You're signed in</h2>
      <p className="text-sm text-neutral-500">Redirecting...</p>
    </>
  );
}

function ErrorContent({ message }: { message: string }) {
  return (
    <>
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          className="text-red-600"
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
      <h2 className="text-lg font-medium text-neutral-800 mb-2">Link not valid</h2>
      <p className="text-sm text-neutral-500 mb-6">{message}</p>
      <Link to="/login" className="btn-primary">
        Request a new link
      </Link>
    </>
  );
}
