import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

export interface TestGroup {
  groupId: string;
  groupName: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  magicLink: string;
  // Aliases for backwards compatibility
  adminEmail: string;
  adminName: string;
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function createTestGroup(name: string): TestGroup {
  const groupId = generateId();
  const ownerId = generateId();
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900; // 15 minutes

  const ownerName = `Owner ${name}`;
  const ownerEmail = `owner-${groupId.slice(0, 8)}@test.local`;

  // Create user first (needed before group due to owner_id FK)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO users (id, name, email, created_at) VALUES ('${ownerId}', '${ownerName}', '${ownerEmail}', ${now});"`,
    { stdio: 'pipe' }
  );

  // Insert group with owner_id
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO groups (id, name, owner_id, created_at) VALUES ('${groupId}', '${name}', '${ownerId}', ${now});"`,
    { stdio: 'pipe' }
  );

  // Create membership for owner with role='admin' (owner is identified via groups.owner_id)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${ownerId}', '${groupId}', 'admin', ${now});"`,
    { stdio: 'pipe' }
  );

  // Create login magic link token (user already exists)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at) VALUES ('${token}', '${groupId}', '${ownerEmail}', 'login', NULL, ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return {
    groupId,
    groupName: name,
    ownerId,
    ownerEmail,
    ownerName,
    magicLink: `http://localhost:5173/auth/${token}`,
    // Aliases for backwards compatibility
    adminEmail: ownerEmail,
    adminName: ownerName,
  };
}

export function createTestMember(
  groupId: string,
  name: string
): { email: string; name: string; magicLink: string } {
  const uniqueId = generateId().slice(0, 8);
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900;

  const email = `member-${uniqueId}@test.local`;

  // Create magic link token (user + membership will be created when token is verified)
  // New users will be prompted to enter their name on the verification page
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at) VALUES ('${token}', '${groupId}', '${email}', 'invite', 'member', ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return { email, name, magicLink: `http://localhost:5173/auth/${token}` };
}

export function createTestAdmin(
  groupId: string,
  name: string
): { email: string; name: string; magicLink: string } {
  const uniqueId = generateId().slice(0, 8);
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900;

  const email = `admin-${uniqueId}@test.local`;

  // Create magic link token with admin role (user + membership will be created when token is verified)
  // New users will be prompted to enter their name on the verification page
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at) VALUES ('${token}', '${groupId}', '${email}', 'invite', 'admin', ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return { email, name, magicLink: `http://localhost:5173/auth/${token}` };
}

export function createFreshMagicLink(
  groupId: string,
  email: string,
  type: 'invite' | 'login' = 'login',
  role: 'admin' | 'member' | null = null
): string {
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900;

  const roleValue = role ? `'${role}'` : 'NULL';
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at) VALUES ('${token}', '${groupId}', '${email}', '${type}', ${roleValue}, ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return `http://localhost:5173/auth/${token}`;
}

export function cleanupTestGroup(groupId: string): void {
  // Delete in order due to foreign key constraints
  // Note: groups.owner_id references users, so groups must be deleted before users
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM photo_reactions WHERE photo_id IN (SELECT id FROM photos WHERE group_id = '${groupId}');"`,
    { stdio: 'pipe' }
  );
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM photo_views WHERE photo_id IN (SELECT id FROM photos WHERE group_id = '${groupId}');"`,
    { stdio: 'pipe' }
  );
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM photos WHERE group_id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM magic_link_tokens WHERE group_id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
  // Delete memberships first
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM memberships WHERE group_id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
  // Delete the group (must come before deleting users due to owner_id FK)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM groups WHERE id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
  // Now we can delete users who were only in this group
  // Since we deleted memberships, we need a different approach - delete users with no memberships who were the owner
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM users WHERE id NOT IN (SELECT user_id FROM memberships) AND email LIKE '%@test.local';"`,
    { stdio: 'pipe' }
  );
}

export async function waitForServer(
  url: string,
  maxWaitMs: number = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} not ready after ${maxWaitMs}ms`);
}
