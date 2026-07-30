import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';
import { Button, ButtonLink } from '../components/Button';

type VerifyStatus =
  | 'verifying'
  | 'confirm_switch'
  | 'needs_name'
  | 'submitting_name'
  | 'success'
  | 'error';

const NAME_FORM_WARNING_MS = 4 * 60 * 1000; // Show warning after 4 minutes

export function AuthVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { login, user: currentUser, loading: authLoading } = useAuth();
  const [switchConfirmed, setSwitchConfirmed] = useState(false);
  const [status, setStatus] = useState<VerifyStatus>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  // The token this page is currently verifying, or has verified. It both
  // deduplicates the verify effect and decides whether a response is still
  // wanted — see verify() below.
  const activeToken = useRef<string | null>(null);
  const nameFormShownAt = useRef<number | null>(null);

  // Both handlers below take the token their response came from and drop it
  // unless that token is still the one on screen. Opening a second link while
  // the first request is in flight leaves that request live: applying its
  // result would sign the user in off the link they navigated away from, or
  // bury the new link's screen under the old one's error. (Checked against the
  // ref rather than an effect-cleanup flag, which StrictMode's immediate
  // teardown of the first pass would trip.)
  const handleVerificationResult = useCallback(
    async (verifiedToken: string, data: Awaited<ReturnType<typeof api.auth.verifyMagicLink>>) => {
      if (activeToken.current !== verifiedToken) return;

      if ('needsName' in data) {
        setStatus('needs_name');
        setShowExpiryWarning(false);
        nameFormShownAt.current = Date.now();
        return;
      }

      // Awaited: login purges the previous session's caches before publishing
      // the new state, and navigating before that finishes would let the feed
      // read another user's cached photo list.
      await login(
        data.accessToken,
        data.user,
        data.currentGroup ?? null,
        data.groups ?? [],
        data.needsGroupSelection ?? false,
        data.selectionToken ?? null,
        data.currentGroupDisplayName ?? null
      );

      setStatus('success');

      setTimeout(() => {
        navigate('/', { replace: true });
      }, 500);
    },
    [login, navigate]
  );

  const handleVerificationError = useCallback((verifiedToken: string, error: unknown) => {
    if (activeToken.current !== verifiedToken) return;

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
  }, []);

  useEffect(() => {
    // Keyed by the token rather than a boolean. The guard exists for StrictMode's
    // double effect invocation — a magic link is single-use, so verifying twice
    // burns it — but a boolean also blocks the legitimate case where the :token
    // param changes on a reused component instance, i.e. the user opens a second
    // magic link from the first one's error screen.
    if (!token || activeToken.current === token) {
      return;
    }

    // Verifying consumes the single-use token and replaces any live session,
    // so with someone already signed in nothing happens until they confirm
    // the switch — silently swapping accounts under them is how a shared
    // laptop ends up posting as the wrong person.
    if (authLoading) {
      return;
    }
    if (currentUser && !switchConfirmed) {
      setStatus('confirm_switch');
      return;
    }

    activeToken.current = token;

    async function verify(tokenToVerify: string) {
      // Drop whatever the previous token left on screen — otherwise a second
      // link opened from the first one's error screen keeps showing that error
      // until the new request comes back.
      setStatus('verifying');
      setErrorMessage('');
      try {
        const data = await api.auth.verifyMagicLink(tokenToVerify);
        await handleVerificationResult(tokenToVerify, data);
      } catch (error) {
        handleVerificationError(tokenToVerify, error);
      }
    }

    verify(token);
  }, [
    token,
    authLoading,
    currentUser,
    switchConfirmed,
    handleVerificationResult,
    handleVerificationError,
  ]);

  // Show expiry warning if user is on name form for too long
  useEffect(() => {
    if (status !== 'needs_name' || !nameFormShownAt.current) {
      return;
    }

    const timeElapsed = Date.now() - nameFormShownAt.current;
    const timeUntilWarning = Math.max(0, NAME_FORM_WARNING_MS - timeElapsed);

    const timer = setTimeout(() => {
      setShowExpiryWarning(true);
    }, timeUntilWarning);

    return () => clearTimeout(timer);
  }, [status]);

  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setNameError('Please enter your name');
      return;
    }

    setNameError('');
    setStatus('submitting_name');

    const submittedToken = token!;
    try {
      const data = await api.auth.verifyMagicLink(submittedToken, name.trim());
      await handleVerificationResult(submittedToken, data);
    } catch (error) {
      handleVerificationError(submittedToken, error);
    }
  };

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
          ) : status === 'confirm_switch' && currentUser ? (
            <ConfirmSwitchContent
              currentName={currentUser.name}
              onContinue={() => setSwitchConfirmed(true)}
              onCancel={() => navigate('/', { replace: true })}
            />
          ) : status === 'needs_name' || status === 'submitting_name' ? (
            <NameInputContent
              name={name}
              setName={setName}
              nameError={nameError}
              onSubmit={handleNameSubmit}
              isSubmitting={status === 'submitting_name'}
              showExpiryWarning={showExpiryWarning}
            />
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

function ConfirmSwitchContent({
  currentName,
  onContinue,
  onCancel,
}: {
  currentName: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <h2 className="text-lg font-medium text-text-primary mb-2">
        You're signed in as {currentName}
      </h2>
      <p className="text-sm text-text-secondary mb-6">
        Continuing signs this device in with the account the link was emailed to, replacing the
        current session.
      </p>
      <div className="flex gap-3 justify-center">
        <Button variant="secondary" onClick={onCancel}>
          Stay signed in
        </Button>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </>
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

interface NameInputContentProps {
  name: string;
  setName: (name: string) => void;
  nameError: string;
  onSubmit: (e: FormEvent) => void;
  isSubmitting: boolean;
  showExpiryWarning: boolean;
}

function NameInputContent({
  name,
  setName,
  nameError,
  onSubmit,
  isSubmitting,
  showExpiryWarning,
}: NameInputContentProps) {
  return (
    <>
      <h2 className="text-lg font-medium text-text-primary mb-2">Welcome!</h2>
      <p className="text-sm text-text-secondary mb-6">Please enter your name to complete sign-up</p>
      {showExpiryWarning && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
          This link will expire soon. Please complete sign-up now.
        </div>
      )}
      <form onSubmit={onSubmit} className="text-left">
        <div className="mb-4">
          <label htmlFor="signup-name" className="block text-sm font-medium text-text-primary mb-2">
            Your name
          </label>
          <input
            type="text"
            id="signup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
            disabled={isSubmitting}
            autoComplete="name"
            autoFocus
          />
          {nameError && (
            <p className="mt-2 text-sm text-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner spinner-sm" />
              Completing sign-up...
            </span>
          ) : (
            'Continue'
          )}
        </Button>
      </form>
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
      <ButtonLink to="/login" size="lg">
        Request a new link
      </ButtonLink>
    </>
  );
}
