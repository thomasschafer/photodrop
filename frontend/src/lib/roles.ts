export type MembershipRole = 'admin' | 'member';
export type DisplayRole = MembershipRole | 'owner';

export const ROLE_DISPLAY_NAMES: Record<DisplayRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
