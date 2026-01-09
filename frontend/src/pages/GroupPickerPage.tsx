import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';

export function GroupPickerPage() {
  const { user, groups, selectGroup, logout } = useAuth();
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectGroup = async (groupId: string) => {
    setIsLoading(groupId);
    setError(null);
    try {
      await selectGroup(groupId);
    } catch (err) {
      setError('Failed to select group. Please try again.');
      console.error('Failed to select group:', err);
    } finally {
      setIsLoading(null);
    }
  };

  // Empty state - user has no groups
  if (groups.length === 0) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-8 flex justify-center">
            <Logo size="lg" />
          </div>

          <div className="bg-surface rounded-xl p-8 border border-border">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-bg-secondary flex items-center justify-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-text-tertiary"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>

            <h1 className="text-xl font-semibold text-text-primary mb-3">No groups yet</h1>

            <p className="text-text-secondary mb-6">
              You're not a member of any groups yet. Ask someone to invite you to their group.
            </p>

            <p className="text-sm text-text-tertiary mb-6">
              Signed in as <span className="font-medium text-text-secondary">{user?.email}</span>
            </p>

            <button
              onClick={logout}
              className="text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Group selection
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mx-auto mb-8 flex justify-center">
          <Logo size="lg" />
        </div>

        <div className="bg-surface rounded-xl p-8 border border-border">
          <h1 className="text-xl font-semibold text-text-primary mb-2 text-center">
            Choose a group
          </h1>

          <p className="text-text-secondary text-center mb-6">
            You're a member of multiple groups. Select one to continue.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => handleSelectGroup(group.id)}
                disabled={isLoading !== null}
                className="w-full flex items-center justify-between p-4 rounded-lg border border-border bg-bg-primary hover:border-accent hover:bg-bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                    <span className="text-accent font-semibold">
                      {group.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-text-primary">{group.name}</div>
                    <div className="text-xs text-text-tertiary capitalize">{group.role}</div>
                  </div>
                </div>

                {isLoading === group.id ? (
                  <div className="spinner w-5 h-5" />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-text-tertiary"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-border text-center">
            <p className="text-sm text-text-tertiary mb-2">
              Signed in as <span className="font-medium text-text-secondary">{user?.email}</span>
            </p>
            <button
              onClick={logout}
              className="text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
