import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { Modal } from './Modal';

type Stage = 'main' | 'leave' | 'delete' | 'deletion-sent';

export function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, currentGroup, leaveGroup } = useAuth();
  const [stage, setStage] = useState<Stage>('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !currentGroup) return null;
  const isOwner = currentGroup.ownerId === user.id;

  const leave = async () => {
    setLoading(true);
    setError(null);
    try {
      await leaveGroup();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to leave the group');
      setLoading(false);
    }
  };

  const requestDeletion = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.users.requestAccountDeletion();
      setStage('deletion-sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send the confirmation email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Account settings" onClose={onClose} maxWidth="md">
      {error && (
        <p className="mb-4 text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {stage === 'main' && (
        <div className="space-y-6">
          <section>
            <h4 className="font-medium text-text-primary">Leave {currentGroup.name}</h4>
            <p className="mt-1 text-sm text-text-secondary">
              You will immediately lose access. Your previous photos, comments and reactions stay in
              the family archive under “Former member”.
            </p>
            {isOwner ? (
              <p className="mt-3 text-sm text-text-muted">
                As owner, transfer ownership in Group settings or delete the group first.
              </p>
            ) : (
              <Button onClick={() => setStage('leave')} variant="secondary" className="mt-3">
                Leave group
              </Button>
            )}
          </section>

          <section className="pt-5 border-t border-border">
            <h4 className="font-medium text-red-600 dark:text-red-400">Delete account</h4>
            <p className="mt-1 text-sm text-text-secondary">
              Remove your account details and reactions permanently. Photos and comments remain in
              family archives under “Deleted user”.
            </p>
            <Button onClick={() => setStage('delete')} variant="danger" className="mt-3">
              Delete account
            </Button>
          </section>
        </div>
      )}

      {stage === 'leave' && (
        <div>
          <p className="text-sm text-text-secondary">
            Are you sure you want to leave <strong>{currentGroup.name}</strong>? You will need a new
            invitation to rejoin.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button onClick={() => setStage('main')} variant="secondary" disabled={loading}>
              Cancel
            </Button>
            <Button onClick={leave} variant="danger" disabled={loading}>
              {loading ? 'Leaving…' : 'Leave group'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'delete' && (
        <div>
          <p className="text-sm text-text-secondary">
            We’ll email <strong>{user.email}</strong> a link. Opening it does not delete anything;
            you will review the consequences and confirm one final time.
          </p>
          {isOwner && (
            <p className="mt-3 text-sm text-text-muted">
              You must transfer ownership of or delete every group you own before the email can be
              sent.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button onClick={() => setStage('main')} variant="secondary" disabled={loading}>
              Cancel
            </Button>
            <Button onClick={requestDeletion} variant="danger" disabled={loading}>
              {loading ? 'Sending…' : 'Email confirmation link'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'deletion-sent' && (
        <div role="status">
          <h4 className="font-medium text-text-primary">Check your email</h4>
          <p className="mt-2 text-sm text-text-secondary">
            The confirmation link expires in 15 minutes. Your account has not been changed yet.
          </p>
          <div className="mt-6 flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
