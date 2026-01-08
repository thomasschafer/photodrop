import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

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

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-neutral-50">
        <div className="text-center px-6 max-w-md">
          <h1 className="text-5xl font-black text-primary-600 mb-4 tracking-tight">photodrop</h1>
          <div className="card">
            <div className="text-4xl mb-4" aria-hidden="true">
              ✗
            </div>
            <h2 className="text-xl font-bold text-neutral-800 mb-2">Link not valid</h2>
            <p className="text-neutral-600 mb-6">Invalid link. No token provided.</p>
            <Link to="/login" className="btn-primary inline-block">
              Request a new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-neutral-50">
      <div className="text-center px-6 max-w-md">
        <h1 className="text-5xl font-black text-primary-600 mb-4 tracking-tight">photodrop</h1>

        <div className="card">
          {status === 'verifying' && (
            <>
              <div
                className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"
                role="status"
                aria-label="Verifying your login link"
              />
              <p className="text-neutral-600">Verifying your link...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-4xl mb-4" aria-hidden="true">
                ✓
              </div>
              <h2 className="text-xl font-bold text-neutral-800 mb-2">You're in!</h2>
              <p className="text-neutral-600">Redirecting you to the app...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-4xl mb-4" aria-hidden="true">
                ✗
              </div>
              <h2 className="text-xl font-bold text-neutral-800 mb-2">Link not valid</h2>
              <p className="text-neutral-600 mb-6">{errorMessage}</p>
              <Link to="/login" className="btn-primary inline-block">
                Request a new link
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
