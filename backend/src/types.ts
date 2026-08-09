/**
 * Shared type definitions for the photodrop backend
 */
import type { MembershipRole } from './lib/db';

export type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  FRONTEND_URL: string;
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

export type Variables = {
  user: {
    id: string;
    groupId: string;
    role: MembershipRole;
  };
};

/** Shorthand for Hono app/route type parameters */
export type AppEnv = { Bindings: Bindings; Variables: Variables };
