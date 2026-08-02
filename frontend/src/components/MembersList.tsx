import { useState, useEffect, useCallback, useRef } from 'react';
import type { MemberJson } from '@photodrop/common/apiTypes';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';
import { displayNameFromInput } from '../lib/displayName';
import { useFocusRestore } from '../lib/hooks';
import { ROLE_DISPLAY_NAMES } from '../lib/roles';
import { setNativeScreenshotProtection } from '../lib/privacyScreen';
import { exportGroup, type GroupExportProgress } from '../lib/groupExport';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { InviteForm } from './InviteForm';
import { NameField } from './NameField';

export function MembersList() {
  const { user, currentGroup, onGroupDeleted, refreshAuth } = useAuth();
  const [members, setMembers] = useState<MemberJson[]>([]);
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
  const [editingDisplayName, setEditingDisplayName] = useState<{
    memberId: string;
    /** The member's own name — what clearing the override reverts to. */
    canonicalName: string;
    /** The stored override, so an unchanged field can skip the request. */
    savedDisplayName: string | null;
    value: string;
  } | null>(null);
  const [deleteGroupModal, setDeleteGroupModal] = useState<{
    stage: 'closed' | 'loading-count' | 'confirm' | 'deleting' | 'error';
    confirmText: string;
    photoCount: number | null;
    error: string | null;
  }>({ stage: 'closed', confirmText: '', photoCount: null, error: null });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<GroupExportProgress | null>(null);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');

  const [inviteButtonRef, restoreInviteFocus] = useFocusRestore<HTMLButtonElement>();
  const [deleteGroupButtonRef, restoreDeleteGroupFocus] = useFocusRestore<HTMLButtonElement>();
  const editNameButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const removeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const roleSelectRefs = useRef<Map<string, HTMLSelectElement>>(new Map());
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const showSuccess = (message: string) => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    setSuccessMessage(message);
    successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleImageProtectionToggle = async (
    memberId: string,
    memberName: string,
    enabled: boolean
  ) => {
    if (!currentGroup) return;

    setActionLoading(memberId);
    setError(null);

    // Optimistic update
    setMembers((prev) =>
      prev.map((m) => (m.userId === memberId ? { ...m, imageProtection: enabled } : m))
    );

    try {
      await api.groups.updateMemberImageProtection(currentGroup.id, memberId, enabled);
    } catch (err) {
      // Undo only this member's own change against the live list, rather than
      // restoring a whole-list snapshot taken before the request: another
      // member's toggle can land while this one is in flight (only the toggled
      // row is disabled), and a snapshot restore would silently discard it.
      setMembers((prev) =>
        prev.map((m) => (m.userId === memberId ? { ...m, imageProtection: !enabled } : m))
      );
      console.error('Failed to update image protection:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(`Failed to update image protection: ${err.message}`);
      } else {
        setError('Failed to update image protection');
      }
      return;
    } finally {
      setActionLoading(null);
    }

    // If toggling own protection, update the privacy screen and notify AuthContext.
    // The server has already persisted the change by this point, so the native
    // call is best-effort — failing it must not roll the UI back to assert the
    // opposite of what's stored (AuthContext applies it the same way).
    if (memberId === user?.id) {
      setNativeScreenshotProtection(enabled).catch((err) => {
        console.error('Failed to update native screenshot protection:', err);
      });
      window.dispatchEvent(new CustomEvent('imageProtectionChanged', { detail: { enabled } }));
    }
    showSuccess(`Image protection ${enabled ? 'enabled' : 'disabled'} for ${memberName}`);
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

  const handleDisplayNameRequest = (member: MemberJson) => {
    setEditingDisplayName({
      memberId: member.userId,
      canonicalName: member.canonicalName,
      savedDisplayName: member.displayName,
      value: member.displayName ?? '',
    });
  };

  const handleDisplayNameConfirm = async () => {
    if (!currentGroup || !editingDisplayName) return;

    const { memberId, savedDisplayName, value } = editingDisplayName;
    const nextDisplayName = displayNameFromInput(value);

    if (nextDisplayName === savedDisplayName) {
      setEditingDisplayName(null);
      editNameButtonRefs.current.get(memberId)?.focus();
      return;
    }

    setActionLoading(memberId);
    setError(null);

    try {
      const updated = await api.groups.setMemberDisplayName(
        currentGroup.id,
        memberId,
        nextDisplayName
      );
      // Take every name from the response rather than deriving them: it is
      // re-read server-side after the write, so a canonical name changed by the
      // member meanwhile lands here too. Only this member's row is touched, so
      // a change to another row made while this request was in flight survives.
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === memberId
            ? {
                ...m,
                name: updated.name,
                displayName: updated.displayName,
                canonicalName: updated.canonicalName,
              }
            : m
        )
      );
      setEditingDisplayName(null);
      editNameButtonRefs.current.get(memberId)?.focus();
      showSuccess(
        updated.displayName === null
          ? `${updated.name} is now shown under their own name`
          : `Now showing as ${updated.name} in ${currentGroup.name}`
      );
    } catch (err) {
      console.error('Failed to update display name:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update display name');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisplayNameCancel = () => {
    const memberIdToFocus = editingDisplayName?.memberId;
    setEditingDisplayName(null);
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

  const handleExport = async () => {
    if (!currentGroup) return;
    setExportLoading(true);
    setExportProgress(null);
    setError(null);
    try {
      await exportGroup(currentGroup.id, setExportProgress);
      showSuccess('Group export downloaded');
    } catch (err) {
      console.error('Failed to export group:', err);
      setError(err instanceof Error ? err.message : 'Failed to export group');
    } finally {
      setExportLoading(false);
      setExportProgress(null);
    }
  };

  const handleTransferOwnership = async () => {
    if (!currentGroup || !newOwnerId) return;
    setActionLoading('transfer-ownership');
    setError(null);
    try {
      await api.groups.transferOwnership(currentGroup.id, newOwnerId);
      const newOwner = members.find((member) => member.userId === newOwnerId);
      setOwnerId(newOwnerId);
      setMembers((prev) =>
        prev.map((member) => (member.userId === newOwnerId ? { ...member, role: 'admin' } : member))
      );
      setShowTransferOwnership(false);
      setNewOwnerId('');
      await refreshAuth();
      showSuccess(`Ownership transferred to ${newOwner?.name ?? 'the new owner'}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to transfer ownership');
    } finally {
      setActionLoading(null);
    }
  };

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
      await onGroupDeleted();
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

  const groupName = currentGroup?.name ?? 'this group';

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary mb-1">Group members</h2>
          <p className="text-sm text-text-secondary">
            {members.length} {members.length === 1 ? 'member' : 'members'} in {currentGroup?.name}
          </p>
        </div>
        <Button
          ref={inviteButtonRef}
          onClick={() => setShowInviteModal(true)}
          size="sm"
          className="gap-2 -mt-1"
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
        </Button>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 py-2 px-4 rounded-lg bg-green-600 dark:bg-green-700 text-white text-sm shadow-lg flex items-center gap-2"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
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

      {editingDisplayName && (
        <ConfirmModal
          title="Display name"
          message={
            editingDisplayName.savedDisplayName === null ? (
              <>
                <span className="font-medium text-text-primary">
                  {editingDisplayName.canonicalName}
                </span>{' '}
                is shown under their own name. Give them a different name just for {groupName} —
                their name in other groups is unaffected.
              </>
            ) : (
              <>
                <span className="font-medium text-text-primary">
                  {editingDisplayName.canonicalName}
                </span>{' '}
                is shown as{' '}
                <span className="font-medium text-text-primary">
                  {editingDisplayName.savedDisplayName}
                </span>{' '}
                in {groupName}. Their own name is theirs alone to change; this one applies only to{' '}
                {groupName}.
              </>
            )
          }
          confirmLabel="Save"
          isLoading={actionLoading === editingDisplayName.memberId}
          onConfirm={handleDisplayNameConfirm}
          onCancel={handleDisplayNameCancel}
        >
          <NameField
            id="member-display-name"
            label={`Display name in ${groupName}`}
            value={editingDisplayName.value}
            onChange={(value) => setEditingDisplayName({ ...editingDisplayName, value })}
            onEnter={handleDisplayNameConfirm}
            // An empty field means "no override", which shows the member's own
            // name — so that is what the placeholder previews.
            placeholder={editingDisplayName.canonicalName}
            hint={`Leave empty to ${
              editingDisplayName.savedDisplayName === null ? 'keep' : 'go back to'
            } showing their own name, ${editingDisplayName.canonicalName}.`}
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

      {showTransferOwnership && (
        <ConfirmModal
          title="Transfer ownership"
          message="The new owner will have full control of the group. You will remain an admin."
          confirmLabel="Transfer ownership"
          confirmDisabled={!newOwnerId}
          isLoading={actionLoading === 'transfer-ownership'}
          onConfirm={handleTransferOwnership}
          onCancel={() => {
            setShowTransferOwnership(false);
            setNewOwnerId('');
          }}
        >
          <label htmlFor="new-owner" className="block text-sm font-medium text-text-primary mb-2">
            New owner
          </label>
          <select
            id="new-owner"
            value={newOwnerId}
            onChange={(event) => setNewOwnerId(event.target.value)}
            className="input-field"
            autoFocus
          >
            <option value="">Choose a member</option>
            {members
              .filter((member) => member.userId !== ownerId)
              .map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} ({member.email})
                </option>
              ))}
          </select>
        </ConfirmModal>
      )}

      <div className="divide-y divide-border">
        {members.map((member) => {
          const isCurrentUser = member.userId === user?.id;
          const memberIsOwner = member.userId === ownerId;
          const isLoading = actionLoading === member.userId;

          return (
            <div key={member.userId} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={member.name} color={member.profileColor} size="lg" />
                  <div className="min-w-0">
                    <div className="font-medium text-text-primary truncate">
                      {member.name}
                      {isCurrentUser && <span className="ml-2 text-xs text-text-muted">(you)</span>}
                      {member.displayName !== null && (
                        <span
                          className="ml-2 align-middle text-[10px] font-medium uppercase tracking-wide py-0.5 px-1.5 rounded bg-bg-tertiary text-text-muted"
                          title={`A display name is set for ${groupName}, so this is not their own name`}
                        >
                          Display name
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary break-words mobile:truncate">
                      {member.displayName !== null && (
                        <>
                          {/* Labelled, not merely set beside the email: two bare
                              names on one line read as two different people. */}
                          <span className="block mobile:inline">
                            Own name: {member.canonicalName}
                          </span>
                          <span
                            className="hidden mobile:inline mx-1.5 text-text-muted"
                            aria-hidden="true"
                          >
                            ·
                          </span>
                        </>
                      )}
                      <span className="block mobile:inline">{member.email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                  <button
                    ref={(el) => {
                      if (el) {
                        editNameButtonRefs.current.set(member.userId, el);
                      } else {
                        editNameButtonRefs.current.delete(member.userId);
                      }
                    }}
                    onClick={() => handleDisplayNameRequest(member)}
                    disabled={isLoading}
                    className="p-2 text-text-muted hover:text-accent transition-colors disabled:opacity-50 cursor-pointer min-w-[44px] min-h-[44px]"
                    title={`Set display name in ${groupName}`}
                    aria-label={`Set ${member.name}'s display name in ${groupName}`}
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
                      className="input-field py-2 px-2 text-sm w-[92px] mobile:w-[100px] min-h-[44px]"
                    >
                      <option value="admin">{ROLE_DISPLAY_NAMES.admin}</option>
                      <option value="member">{ROLE_DISPLAY_NAMES.member}</option>
                    </select>
                  )}

                  <button
                    onClick={() =>
                      handleImageProtectionToggle(
                        member.userId,
                        member.name,
                        !member.imageProtection
                      )
                    }
                    disabled={isLoading}
                    className={`p-2 rounded-md transition-colors disabled:opacity-50 cursor-pointer min-w-[44px] min-h-[44px] ${
                      member.imageProtection
                        ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                    title={
                      member.imageProtection
                        ? `Image protection on — click to allow ${member.name} to save images`
                        : `Image protection off — click to block ${member.name} from saving images`
                    }
                    aria-label={
                      member.imageProtection
                        ? `Disable image protection for ${member.name}`
                        : `Enable image protection for ${member.name}`
                    }
                  >
                    {member.imageProtection ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    )}
                  </button>

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
                    className={`p-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] ${
                      memberIsOwner
                        ? 'text-text-muted'
                        : 'text-text-muted hover:text-red-600 dark:hover:text-red-400 cursor-pointer'
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

      <div className="mt-8 pt-6 border-t border-border">
        <h3 className="text-base font-medium text-text-primary mb-2">Family archive</h3>
        <p className="text-sm text-text-secondary mb-4">
          Download the converted photos currently stored, together with captions, upload dates and
          uploader names. Only admins can export.
        </p>
        <div aria-live="polite">
          <Button onClick={handleExport} variant="secondary" disabled={exportLoading}>
            {exportLoading
              ? exportProgress
                ? `Exporting ${exportProgress.completed}/${exportProgress.total}…`
                : 'Preparing export…'
              : 'Export group'}
          </Button>
        </div>
      </div>

      {isOwner && members.some((member) => member.userId !== ownerId) && (
        <div className="mt-8 pt-6 border-t border-border">
          <h3 className="text-base font-medium text-text-primary mb-2">Ownership</h3>
          <p className="text-sm text-text-secondary mb-4">
            Transfer ownership to another member. You will remain an admin.
          </p>
          <Button onClick={() => setShowTransferOwnership(true)} variant="secondary">
            Transfer ownership
          </Button>
        </div>
      )}

      {isOwner && (
        <div className="mt-8 pt-6 border-t border-border">
          <h3 className="text-base font-medium text-red-600 dark:text-red-400 mb-2">Danger zone</h3>
          <p className="text-sm text-text-secondary mb-4">
            Permanently delete this group and all its photos. This action cannot be undone.
          </p>
          <Button
            ref={deleteGroupButtonRef}
            onClick={openDeleteGroupModal}
            variant="danger"
            size="md"
          >
            Delete group
          </Button>
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
