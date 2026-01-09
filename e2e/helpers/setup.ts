import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

export interface TestGroup {
  groupId: string;
  groupName: string;
  adminEmail: string;
  adminName: string;
  magicLink: string;
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function createTestGroup(name: string): TestGroup {
  const groupId = generateId();
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900; // 15 minutes

  const adminName = `Admin ${name}`;
  const adminEmail = `admin-${groupId.slice(0, 8)}@test.local`;

  // Insert group
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO groups (id, name, created_at, created_by) VALUES ('${groupId}', '${name}', ${now}, 'e2e-test');"`,
    { stdio: 'pipe' }
  );

  // Create magic link token (user + membership will be created when token is verified)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, invite_name, created_at, expires_at) VALUES ('${token}', '${groupId}', '${adminEmail}', 'invite', 'admin', '${adminName}', ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return {
    groupId,
    groupName: name,
    adminEmail,
    adminName,
    magicLink: `http://localhost:5173/auth/${token}`,
  };
}

export function createTestMember(
  groupId: string,
  name: string
): { email: string; magicLink: string } {
  const uniqueId = generateId().slice(0, 8);
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 900;

  const email = `member-${uniqueId}@test.local`;

  // Create magic link token (user + membership will be created when token is verified)
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, invite_name, created_at, expires_at) VALUES ('${token}', '${groupId}', '${email}', 'invite', 'member', '${name}', ${now}, ${expiresAt});"`,
    { stdio: 'pipe' }
  );

  return { email, magicLink: `http://localhost:5173/auth/${token}` };
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
  // Delete users who are members of this group (and only this group)
  // First get user IDs that are ONLY in this group
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM users WHERE id IN (SELECT user_id FROM memberships WHERE group_id = '${groupId}') AND id NOT IN (SELECT user_id FROM memberships WHERE group_id != '${groupId}');"`,
    { stdio: 'pipe' }
  );
  // Delete memberships for this group
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM memberships WHERE group_id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM groups WHERE id = '${groupId}';"`,
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
