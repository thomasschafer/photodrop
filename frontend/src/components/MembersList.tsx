import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';
import { useFocusRestore } from '../lib/hooks';
import { ROLE_DISPLAY_NAMES, type MembershipRole } from '../lib/roles';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { InviteForm } from './InviteForm';

interface Member {
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: number;
}

export function MembersList() {
  const { user, currentGroup, onGroupDeleted } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
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
    newRole: 'admin' | 'member'; // Owners cannot be changed, so only admin/member allowed
  } | null>(null);
  const [editingName, setEditingName] = useState<{
    memberId: string;
    currentName: string;
    newName: string;
  } | null>(null);
  const [deleteGroupModal, setDeleteGroupModal] = useState<{
    stage: 'closed' | 'loading-count' | 'confirm' | 'deleting' | 'error';
    confirmText: string;
    photoCount: number | null;
    error: string | null;
  }>({ stage: 'closed', confirmText: '', photoCount: null, error: null });
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [inviteButtonRef, restoreInviteFocus] = useFocusRestore<HTMLButtonElement>();
  const [deleteGroupButtonRef, restoreDeleteGroupFocus] = useFocusRestore<HTMLButtonElement>();
  const editNameButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const removeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const roleSelectRefs = useRef<Map<string, HTMLSelectElement>>(new Map());

  const fetchMembers = useCallback(async () => {
    if (!currentGroup) return;

    try {
      setError(null);
      const data = await api.groups.getMembers(currentGroup.id);
      setMembers(data.members);
      setOwnerId(data.ownerId);
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
      roleSelectRefs.current.get(memberId)?.focus();
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

  const handleRoleChangeCancel = () => {
    const memberIdToFocus = confirmRoleChange?.memberId;
    setConfirmRoleChange(null);
    if (memberIdToFocus) {
      roleSelectRefs.current.get(memberIdToFocus)?.focus();
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
      editNameButtonRefs.current.get(memberId)?.focus();
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
      editNameButtonRefs.current.get(memberId)?.focus();
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

  const handleEditNameCancel = () => {
    const memberIdToFocus = editingName?.memberId;
    setEditingName(null);
    if (memberIdToFocus) {
      editNameButtonRefs.current.get(memberIdToFocus)?.focus();
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

  const handleRemoveCancel = () => {
    const memberIdToFocus = confirmRemove?.memberId;
    setConfirmRemove(null);
    if (memberIdToFocus) {
      removeButtonRefs.current.get(memberIdToFocus)?.focus();
    }
  };

  const isOwner = user?.id === ownerId;

  const handleInviteModalClose = () => {
    setShowInviteModal(false);
    restoreInviteFocus();
  };

  const handleDeleteGroupModalClose = () => {
    setDeleteGroupModal({ stage: 'closed', confirmText: '', photoCount: null, error: null });
    restoreDeleteGroupFocus();
  };

  const openDeleteGroupModal = async () => {
    if (!currentGroup) return;

    setDeleteGroupModal({ stage: 'loading-count', confirmText: '', photoCount: null, error: null });

    try {
      const { count } = await api.groups.getPhotoCount(currentGroup.id);
      setDeleteGroupModal({ stage: 'confirm', confirmText: '', photoCount: count, error: null });
    } catch (err) {
      console.error('Failed to get photo count:', err);
      // Still allow deletion even if we can't get the count
      setDeleteGroupModal({ stage: 'confirm', confirmText: '', photoCount: null, error: null });
    }
  };

  const handleDeleteGroup = async () => {
    if (!currentGroup) return;

    setDeleteGroupModal((prev) => ({ ...prev, stage: 'deleting', error: null }));

    try {
      await api.groups.deleteGroup(currentGroup.id);
      onGroupDeleted(currentGroup.id);
    } catch (err) {
      console.error('Failed to delete group:', err);
      let errorMessage = 'Failed to delete group';
      if (err instanceof ApiError) {
        errorMessage = err.message;
      }
      setDeleteGroupModal((prev) => ({
        ...prev,
        stage: 'error',
        error: errorMessage,
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary mb-1">Group members</h2>
          <p className="text-sm text-text-secondary">
            {members.length} {members.length === 1 ? 'member' : 'members'} in {currentGroup?.name}
          </p>
        </div>
        <button
          ref={inviteButtonRef}
          onClick={() => setShowInviteModal(true)}
          className="btn-primary-sm flex items-center gap-2 -mt-1"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
          Invite
        </button>
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
              <span className="font-medium text-text-primary">
                {ROLE_DISPLAY_NAMES[confirmRoleChange.newRole]}
              </span>
              ?
            </>
          }
          isLoading={actionLoading === confirmRoleChange.memberId}
          onConfirm={handleRoleChangeConfirm}
          onCancel={handleRoleChangeCancel}
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
          onCancel={handleEditNameCancel}
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
          onCancel={handleRemoveCancel}
        />
      )}

      <div className="divide-y divide-border">
        {members.map((member) => {
          const isCurrentUser = member.userId === user?.id;
          const memberIsOwner = member.userId === ownerId;
          const isLoading = actionLoading === member.userId;

          return (
            <div key={member.userId} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-col mobile:flex-row mobile:items-center mobile:justify-between gap-3 mobile:gap-4">
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

                <div className="flex items-center gap-3 flex-shrink-0 ml-auto mobile:ml-0">
                  <button
                    ref={(el) => {
                      if (el) {
                        editNameButtonRefs.current.set(member.userId, el);
                      } else {
                        editNameButtonRefs.current.delete(member.userId);
                      }
                    }}
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

                  {memberIsOwner ? (
                    <span
                      className="py-1.5 px-3 text-sm font-medium rounded-md w-[100px] text-center bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      title="Owner role cannot be changed"
                    >
                      {ROLE_DISPLAY_NAMES.owner}
                    </span>
                  ) : (
                    <select
                      ref={(el) => {
                        if (el) {
                          roleSelectRefs.current.set(member.userId, el);
                        } else {
                          roleSelectRefs.current.delete(member.userId);
                        }
                      }}
                      value={member.role}
                      onChange={(e) => {
                        const newRole = e.target.value as 'admin' | 'member';
                        if (newRole !== member.role) {
                          handleRoleChangeRequest(member.userId, member.name, newRole);
                          e.target.value = member.role;
                        }
                      }}
                      disabled={isLoading}
                      className="input-field py-1.5 px-2 text-sm w-[100px]"
                    >
                      <option value="admin">{ROLE_DISPLAY_NAMES.admin}</option>
                      <option value="member">{ROLE_DISPLAY_NAMES.member}</option>
                    </select>
                  )}

                  <button
                    ref={(el) => {
                      if (el) {
                        removeButtonRefs.current.set(member.userId, el);
                      } else {
                        removeButtonRefs.current.delete(member.userId);
                      }
                    }}
                    onClick={() =>
                      setConfirmRemove({ memberId: member.userId, memberName: member.name })
                    }
                    disabled={isLoading || memberIsOwner}
                    className={`p-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      memberIsOwner
                        ? 'text-text-tertiary'
                        : 'text-text-tertiary hover:text-red-600 dark:hover:text-red-400 cursor-pointer'
                    }`}
                    title={memberIsOwner ? 'Owners cannot be removed' : 'Remove from group'}
                    aria-label={
                      memberIsOwner
                        ? 'Owners cannot be removed'
                        : `Remove ${member.name} from group`
                    }
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

      {isOwner && (
        <div className="mt-8 pt-6 border-t border-border">
          <h3 className="text-base font-medium text-red-600 dark:text-red-400 mb-2">Danger zone</h3>
          <p className="text-sm text-text-secondary mb-4">
            Permanently delete this group and all its photos. This action cannot be undone.
          </p>
          <button
            ref={deleteGroupButtonRef}
            onClick={openDeleteGroupModal}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
          >
            Delete group
          </button>
        </div>
      )}

      {deleteGroupModal.stage === 'loading-count' && (
        <Modal title="Delete group" onClose={handleDeleteGroupModalClose}>
          <div className="flex items-center justify-center py-8">
            <div className="spinner" />
          </div>
        </Modal>
      )}

      {deleteGroupModal.stage === 'confirm' && (
        <ConfirmModal
          title="Delete group"
          message={
            <>
              This will <strong>permanently delete</strong> <strong>{currentGroup?.name}</strong>
              {deleteGroupModal.photoCount !== null && deleteGroupModal.photoCount > 0 && (
                <>
                  {' '}
                  and{' '}
                  <strong>
                    {deleteGroupModal.photoCount}{' '}
                    {deleteGroupModal.photoCount === 1 ? 'photo' : 'photos'}
                  </strong>
                </>
              )}
              . This action cannot be undone.
              <br />
              <br />
              Type <strong>delete</strong> to confirm.
            </>
          }
          confirmLabel="Delete group"
          variant="danger"
          isLoading={false}
          confirmDisabled={deleteGroupModal.confirmText.toLowerCase() !== 'delete'}
          onConfirm={handleDeleteGroup}
          onCancel={handleDeleteGroupModalClose}
        >
          <input
            type="text"
            value={deleteGroupModal.confirmText}
            onChange={(e) =>
              setDeleteGroupModal((prev) => ({ ...prev, confirmText: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && deleteGroupModal.confirmText.toLowerCase() === 'delete') {
                handleDeleteGroup();
              }
            }}
            placeholder='Type "delete" to confirm'
            className="input-field w-full"
            autoFocus
          />
        </ConfirmModal>
      )}

      {deleteGroupModal.stage === 'deleting' && (
        <Modal title="Deleting group" onClose={() => {}}>
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="spinner" />
            <p className="text-text-secondary text-center">
              Deleting <strong>{currentGroup?.name}</strong>
              {deleteGroupModal.photoCount !== null && deleteGroupModal.photoCount > 0 && (
                <>
                  {' '}
                  and {deleteGroupModal.photoCount}{' '}
                  {deleteGroupModal.photoCount === 1 ? 'photo' : 'photos'}
                </>
              )}
              ...
            </p>
          </div>
        </Modal>
      )}

      {deleteGroupModal.stage === 'error' && (
        <ConfirmModal
          title="Deletion failed"
          message={
            <>
              <div className="text-red-600 dark:text-red-400 mb-4">{deleteGroupModal.error}</div>
              <p className="text-text-secondary text-sm">
                Please try again. If the problem persists, contact support.
              </p>
            </>
          }
          confirmLabel="Try again"
          variant="danger"
          isLoading={false}
          onConfirm={() => setDeleteGroupModal((prev) => ({ ...prev, stage: 'confirm' }))}
          onCancel={handleDeleteGroupModalClose}
        />
      )}

      {showInviteModal && (
        <Modal title="Invite someone" onClose={handleInviteModalClose}>
          <InviteForm
            isModal
            onInviteSent={(email) => {
              setShowInviteModal(false);
              restoreInviteFocus();
              showSuccess(`Invite sent to ${email}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
