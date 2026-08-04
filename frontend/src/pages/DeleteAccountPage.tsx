import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button, ButtonLink } from '../components/Button';
import { Logo } from '../components/Logo';

export function DeleteAccountPage() {
  const { token } = useParams<{ token: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await api.users.confirmAccountDeletion(token);
      await logout();
      setDeleted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center px-6 py-12">
      <main className="w-full max-w-[480px] mx-auto">
        <div className="mb-4">
          <Logo />
        </div>
        <div className="card">
          {deleted ? (
            <div role="status">
              <h1 className="text-lg font-medium text-text-primary">Account deleted</h1>
              <p className="mt-2 text-sm text-text-secondary">
                Your account details and reactions have been removed. Archive contributions now
                appear under “Deleted user”.
              </p>
              <Button onClick={() => navigate('/', { replace: true })} className="mt-6">
                Done
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-medium text-red-600 dark:text-red-400">
                Permanently delete your account?
              </h1>
              <ul className="mt-4 pl-5 list-disc space-y-2 text-sm text-text-secondary">
                <li>Your account details and every reaction will be removed.</li>
                <li>Your sessions and access to every group will end.</li>
                <li>Photos and comments remain in family archives as “Deleted user”.</li>
                <li>This cannot be undone.</li>
              </ul>
              {error && (
                <p className="mt-4 text-sm text-error" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <ButtonLink to="/" variant="secondary">
                  Cancel
                </ButtonLink>
                <Button onClick={confirm} variant="danger" disabled={loading || !token}>
                  {loading ? 'Deleting…' : 'Delete my account'}
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
