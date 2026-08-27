'use server';

// =============================================================================
// packages/admin — User management server actions (admin-only).
//
// CRUD for admin_users. All mutations are gated on role === 'admin'. Reads
// (listAdminUsers) are also admin-gated because the user list (emails + roles)
// is sensitive. Passwords are never returned except when freshly generated
// (createAdminUser / resetAdminUserPassword return the cleartext once for
// display — the caller must show it and discard it).
// =============================================================================

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { adminUsers, type AdminUser } from '@esperanza/db';
import { getDb } from './db';
import { getCurrentUserOrNull, isAdmin } from './auth';
import { hashPassword, generatePassword } from './password';
import { sendPasswordEmail } from './maillayer';

const SETTINGS_PATH = '/settings/users';

/**
 * Absolute URL of the admin sign-in page, for the password email. Derived from the
 * incoming request Host (consistent with the app's trustHost posture — no hardcoded
 * URL), falling back to ADMIN_PUBLIC_URL when no request scope is available. Returns
 * '' if neither is known; the email still sends (the link just won't render usefully).
 */
async function deriveLoginUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('host');
    if (host) {
      const proto = h.get('x-forwarded-proto') ?? 'https';
      return `${proto}://${host}/login`;
    }
  } catch {
    /* not in a request scope (e.g. unit test without next/headers) */
  }
  const fallback = process.env.ADMIN_PUBLIC_URL?.trim();
  return fallback ? `${fallback.replace(/\/$/, '')}/login` : '';
}

// =============================================================================
// List
// =============================================================================

/** All admin_users, ordered by created_at ascending. Admin-gated. */
export async function listAdminUsers(): Promise<AdminUser[]> {
  if (!(await isAdmin())) return [];
  const { db } = getDb();
  return db
    .select()
    .from(adminUsers)
    .orderBy(sql`coalesce(${adminUsers.createdAt}, '') asc`);
}

// =============================================================================
// Create
// =============================================================================

export interface CreateUserResult {
  error?: string;
  /** Cleartext password — shown once. Null on error. */
  password?: string;
  /** True if the password was emailed to the user via MailLayer (best-effort). */
  emailed?: boolean;
  /** Reason the email failed, when emailed is false. */
  emailError?: string;
}

/**
 * Insert a new admin_users row. The password is auto-generated (URL-safe base64,
 * ~20 bytes entropy) and returned in plaintext — the caller displays it once.
 */
export async function createAdminUser(data: {
  email: string;
  name?: string;
  role: string;
}): Promise<CreateUserResult> {
  if (!(await isAdmin())) return { error: 'Forbidden: admin role required.' };

  const email = data.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { error: 'A valid email is required.' };

  const role = data.role === 'admin' ? 'admin' : 'editor';
  const name = data.name?.trim() || email.split('@')[0]!;
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const { db } = getDb();
  try {
    await db.insert(adminUsers).values({
      email,
      name,
      passwordHash,
      role,
      createdAt: now,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('primary key')) {
      return { error: `A user with email ${email} already exists.` };
    }
    return { error: 'Failed to create user. Please try again.' };
  }

  // Best-effort: email the generated password to the new user. A send failure never
  // turns this into an error result — the cleartext is still returned for the admin to
  // relay manually, and the on-screen one-time password remains the fallback.
  const send = await sendPasswordEmail({
    to: email,
    name,
    password,
    loginUrl: await deriveLoginUrl(),
    isReset: false,
  });

  revalidatePath(SETTINGS_PATH);
  return { password, emailed: send.ok, emailError: send.ok ? undefined : send.error };
}

// =============================================================================
// Update (name + role only — email is the PK and cannot change)
// =============================================================================

export interface UpdateUserResult {
  error?: string;
}

export async function updateAdminUser(
  email: string,
  data: { name?: string; role?: string }
): Promise<UpdateUserResult> {
  if (!(await isAdmin())) return { error: 'Forbidden: admin role required.' };

  const normalEmail = email.trim().toLowerCase();
  if (!normalEmail) return { error: 'Email is required.' };

  const patch: Partial<AdminUser> = {};
  if (data.name !== undefined) patch.name = data.name.trim() || normalEmail.split('@')[0]!;
  if (data.role !== undefined) patch.role = data.role === 'admin' ? 'admin' : 'editor';

  if (Object.keys(patch).length === 0) return {};

  const { db } = getDb();
  const updated = await db
    .update(adminUsers)
    .set(patch)
    .where(eq(sql`lower(${adminUsers.email})`, normalEmail))
    .returning({ email: adminUsers.email });

  if (updated.length === 0) return { error: 'User not found.' };

  revalidatePath(SETTINGS_PATH);
  return {};
}

// =============================================================================
// Reset password
// =============================================================================

export interface ResetPasswordResult {
  error?: string;
  password?: string;
  /** True if the new password was emailed to the user via MailLayer (best-effort). */
  emailed?: boolean;
  /** Reason the email failed, when emailed is false. */
  emailError?: string;
}

/** Generate + store a new random password. Returns the cleartext once. */
export async function resetAdminUserPassword(email: string): Promise<ResetPasswordResult> {
  if (!(await isAdmin())) return { error: 'Forbidden: admin role required.' };

  const normalEmail = email.trim().toLowerCase();
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const { db } = getDb();
  const updated = await db
    .update(adminUsers)
    .set({ passwordHash })
    .where(eq(sql`lower(${adminUsers.email})`, normalEmail))
    .returning({ email: adminUsers.email, name: adminUsers.name });

  if (updated.length === 0) return { error: 'User not found.' };

  // Best-effort: email the new password to the user (see createAdminUser).
  const send = await sendPasswordEmail({
    to: updated[0]!.email,
    name: updated[0]!.name ?? undefined,
    password,
    loginUrl: await deriveLoginUrl(),
    isReset: true,
  });

  revalidatePath(SETTINGS_PATH);
  return { password, emailed: send.ok, emailError: send.ok ? undefined : send.error };
}

// =============================================================================
// Delete
// =============================================================================

export interface DeleteUserResult {
  error?: string;
}

/** Delete a user. Blocks self-deletion. */
export async function deleteAdminUser(email: string): Promise<DeleteUserResult> {
  if (!(await isAdmin())) return { error: 'Forbidden: admin role required.' };

  const normalEmail = email.trim().toLowerCase();
  const currentEmail = await getCurrentUserOrNull();
  if (currentEmail && currentEmail.toLowerCase() === normalEmail) {
    return { error: 'You cannot delete your own account.' };
  }

  const { db } = getDb();
  await db
    .delete(adminUsers)
    .where(eq(sql`lower(${adminUsers.email})`, normalEmail));

  revalidatePath(SETTINGS_PATH);
  return {};
}
