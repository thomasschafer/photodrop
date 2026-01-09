import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';

interface Member {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export function MembersList() {
  const { user, currentGroup } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentGroup) return;

    try {
      setError(null);
      const data = await api.groups.getMembers(currentGroup.id);
      setMembers(data.members);
    } catch (err) {
      console.error('Failed to fetch members:', err);
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [currentGroup]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleRoleChange = async (memberId: string, newRole: 'admin' | 'member') => {
    if (!currentGroup) return;

    setActionLoading(memberId);
    setError(null);

    try {
      await api.groups.updateMemberRole(currentGroup.id, memberId, newRole);
      setMembers((prev) => prev.map((m) => (m.userId === memberId ? { ...m, role: newRole } : m)));
    } catch (err) {
      console.error('Failed to update role:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update role');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!currentGroup) return;

    setActionLoading(memberId);
    setError(null);

    try {
      await api.groups.removeMember(currentGroup.id, memberId);
      setMembers((prev) => prev.filter((m) => m.userId !== memberId));
      setConfirmRemove(null);
    } catch (err) {
      console.error('Failed to remove member:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to remove member');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const adminCount = members.filter((m) => m.role === 'admin').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-text-primary mb-1">Group members</h2>
        <p className="text-sm text-text-secondary">
          {members.length} {members.length === 1 ? 'member' : 'members'} in {currentGroup?.name}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="divide-y divide-border">
        {members.map((member) => {
          const isCurrentUser = member.userId === user?.id;
          const isLastAdmin = member.role === 'admin' && adminCount <= 1;
          const isLoading = actionLoading === member.userId;

          return (
            <div key={member.userId} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-accent font-semibold">
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-text-primary truncate">
                      {member.name}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-text-tertiary">(you)</span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary truncate">{member.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {confirmRemove === member.userId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-secondary">Remove?</span>
                      <button
                        onClick={() => handleRemove(member.userId)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isLoading ? <span className="spinner spinner-sm" /> : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(member.userId, e.target.value as 'admin' | 'member')
                        }
                        disabled={isLoading || (isCurrentUser && isLastAdmin)}
                        className="input-field py-1.5 px-2 text-sm min-w-[100px]"
                        title={
                          isCurrentUser && isLastAdmin
                            ? 'Cannot demote yourself - you are the last admin'
                            : undefined
                        }
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>

                      <button
                        onClick={() => setConfirmRemove(member.userId)}
                        disabled={isLoading || (isCurrentUser && isLastAdmin)}
                        className="p-2 text-text-tertiary hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          isCurrentUser && isLastAdmin
                            ? 'Cannot remove yourself - you are the last admin'
                            : 'Remove from group'
                        }
                        aria-label={`Remove ${member.name} from group`}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {members.length === 0 && (
        <div className="text-center py-8">
          <p className="text-text-secondary">No members yet</p>
        </div>
      )}
    </div>
  );
}
