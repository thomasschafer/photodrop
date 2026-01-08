import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';

interface InviteFormProps {
  onInviteSent?: () => void;
}

export function InviteForm({ onInviteSent }: InviteFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successEmail, setSuccessEmail] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setErrorMessage('Please enter their name');
      setStatus('error');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      await api.auth.sendInvite(name.trim(), email.trim(), role);
      setSuccessEmail(email);
      setStatus('success');
      setName('');
      setEmail('');
      setRole('member');
      onInviteSent?.();

      setTimeout(() => {
        setStatus('idle');
        setSuccessEmail('');
      }, 5000);
    } catch (error) {
      console.error('Failed to send invite:', error);
      setStatus('error');

      if (error instanceof ApiError) {
        if (error.message.includes('already exists')) {
          setErrorMessage('A user with this email already exists');
        } else {
          setErrorMessage(error.message || 'Failed to send invite');
        }
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium text-neutral-800 mb-1">Invite someone</h2>
      <p className="text-sm text-neutral-500 mb-4">Add a new member to your group</p>

      {status === 'success' && (
        <div className="mb-4 p-3 bg-accent-50 border border-accent-200 rounded-lg text-sm text-accent-700">
          Invite sent to <strong>{successEmail}</strong>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="invite-name"
            className="text-sm font-medium text-neutral-700"
            style={{ display: 'block', marginBottom: '0.5rem' }}
          >
            Name
          </label>
          <input
            type="text"
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
            disabled={status === 'loading'}
            autoComplete="off"
          />
        </div>

        <div>
          <label
            htmlFor="invite-email"
            className="text-sm font-medium text-neutral-700"
            style={{ display: 'block', marginBottom: '0.5rem' }}
          >
            Email
          </label>
          <input
            type="email"
            id="invite-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className="input-field"
            disabled={status === 'loading'}
            autoComplete="off"
          />
        </div>

        <div>
          <label
            htmlFor="invite-role"
            className="text-sm font-medium text-neutral-700"
            style={{ display: 'block', marginBottom: '0.5rem' }}
          >
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
            className="input-field"
            disabled={status === 'loading'}
          >
            <option value="member">Member - can view photos</option>
            <option value="admin">Admin - can upload and manage</option>
          </select>
        </div>

        {status === 'error' && (
          <p className="text-sm text-red-600" role="alert">
            {errorMessage}
          </p>
        )}

        <button type="submit" disabled={status === 'loading'} className="btn-primary w-full">
          {status === 'loading' ? (
            <span className="flex items-center gap-2">
              <span className="spinner spinner-sm" />
              Sending...
            </span>
          ) : (
            'Send invite'
          )}
        </button>
      </form>
    </div>
  );
}
