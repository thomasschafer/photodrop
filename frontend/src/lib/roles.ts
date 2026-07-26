import type { MembershipRole } from '@photodrop/common/apiTypes';

export type { MembershipRole };
export type DisplayRole = MembershipRole | 'owner';

export const ROLE_DISPLAY_NAMES: Record<DisplayRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
