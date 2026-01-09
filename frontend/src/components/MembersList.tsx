import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';
import { ConfirmModal } from './ConfirmModal';

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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    memberId: string;
    memberName: string;
  } | null>(null);
  const [confirmRoleChange, setConfirmRoleChange] = useState<{
    memberId: string;
    memberName: string;
    newRole: 'admin' | 'member';
  } | null>(null);
  const [editingName, setEditingName] = useState<{
    memberId: string;
    currentName: string;
    newName: string;
  } | null>(null);

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

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleRoleChangeRequest = (
    memberId: string,
    memberName: string,
    newRole: 'admin' | 'member'
  ) => {
    setConfirmRoleChange({ memberId, memberName, newRole });
  };

  const handleRoleChangeConfirm = async () => {
    if (!currentGroup || !confirmRoleChange) return;

    const { memberId, memberName, newRole } = confirmRoleChange;

    setActionLoading(memberId);
    setError(null);

    try {
      await api.groups.updateMemberRole(currentGroup.id, memberId, newRole);
      setMembers((prev) => prev.map((m) => (m.userId === memberId ? { ...m, role: newRole } : m)));
      setConfirmRoleChange(null);
      showSuccess(`${memberName} is now ${newRole === 'admin' ? 'an admin' : 'a member'}`);
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

  const handleEditNameRequest = (memberId: string, currentName: string) => {
    setEditingName({ memberId, currentName, newName: currentName });
  };

  const handleEditNameConfirm = async () => {
    if (!currentGroup || !editingName) return;

    const { memberId, currentName, newName } = editingName;
    const trimmedName = newName.trim();

    if (trimmedName === currentName) {
      setEditingName(null);
      return;
    }

    setActionLoading(memberId);
    setError(null);

    try {
      await api.groups.updateMemberName(currentGroup.id, memberId, trimmedName);
      setMembers((prev) =>
        prev.map((m) => (m.userId === memberId ? { ...m, name: trimmedName } : m))
      );
      setEditingName(null);
      showSuccess(`Name updated to ${trimmedName}`);
    } catch (err) {
      console.error('Failed to update name:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update name');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveConfirm = async () => {
    if (!currentGroup || !confirmRemove) return;

    const { memberId, memberName } = confirmRemove;

    setActionLoading(memberId);
    setError(null);

    try {
      await api.groups.removeMember(currentGroup.id, memberId);
      setMembers((prev) => prev.filter((m) => m.userId !== memberId));
      setConfirmRemove(null);
      showSuccess(`${memberName} has been removed from the group`);
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

      {successMessage && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm">
          {successMessage}
        </div>
      )}

      {confirmRoleChange && (
        <ConfirmModal
          title="Change role"
          message={
            <>
              Change {confirmRoleChange.memberName}'s role to{' '}
              <span className="font-medium text-text-primary">{confirmRoleChange.newRole}</span>?
            </>
          }
          isLoading={actionLoading === confirmRoleChange.memberId}
          onConfirm={handleRoleChangeConfirm}
          onCancel={() => setConfirmRoleChange(null)}
        />
      )}

      {editingName && (
        <ConfirmModal
          title="Edit name"
          message={`Enter a new name for ${editingName.currentName}:`}
          confirmLabel="Save"
          isLoading={actionLoading === editingName.memberId}
          confirmDisabled={editingName.newName.trim().length === 0}
          onConfirm={handleEditNameConfirm}
          onCancel={() => setEditingName(null)}
        >
          <input
            type="text"
            value={editingName.newName}
            onChange={(e) => setEditingName({ ...editingName, newName: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editingName.newName.trim().length > 0) {
                handleEditNameConfirm();
              }
            }}
            className="input-field w-full"
            autoFocus
          />
        </ConfirmModal>
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remove member"
          message={`Remove ${confirmRemove.memberName} from the group? They will lose access to all photos.`}
          confirmLabel="Remove"
          variant="danger"
          isLoading={actionLoading === confirmRemove.memberId}
          onConfirm={handleRemoveConfirm}
          onCancel={() => setConfirmRemove(null)}
        />
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
                  <button
                    onClick={() => handleEditNameRequest(member.userId, member.name)}
                    disabled={isLoading}
                    className="p-2 text-text-tertiary hover:text-accent transition-colors disabled:opacity-50 cursor-pointer"
                    title="Edit name"
                    aria-label={`Edit ${member.name}'s name`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>

                  <select
                    value={member.role}
                    onChange={(e) => {
                      const newRole = e.target.value as 'admin' | 'member';
                      if (newRole !== member.role) {
                        handleRoleChangeRequest(member.userId, member.name, newRole);
                        e.target.value = member.role;
                      }
                    }}
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
                    onClick={() =>
                      setConfirmRemove({ memberId: member.userId, memberName: member.name })
                    }
                    disabled={isLoading || (isCurrentUser && isLastAdmin)}
                    className="p-2 text-text-tertiary hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
