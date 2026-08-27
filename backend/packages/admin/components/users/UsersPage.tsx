'use client';

// =============================================================================
// User Management — client component for /settings/users.
//
// Displays all admin_users in a table and provides dialogs to:
//   • Add a new user (auto-generated password shown once)
//   • Edit a user's name + role
//   • Reset a user's password (new password shown once)
//   • Delete a user (blocked for own account)
//
// Server actions in lib/user-actions.ts handle all mutations.
// =============================================================================

import { useState, useTransition } from 'react';
import type { AdminUser } from '@esperanza/db';
import {
  createAdminUser,
  updateAdminUser,
  resetAdminUserPassword,
  deleteAdminUser,
} from '../../lib/user-actions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusIcon, PencilIcon, KeyRoundIcon, Trash2Icon, CopyIcon, CheckIcon } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface UsersPageProps {
  users: AdminUser[];
  currentEmail: string;
}

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | null;

// =============================================================================
// Password copy button (shown once after create / reset)
// =============================================================================

function CopyablePassword({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
      <span className="flex-1 select-all break-all">{password}</span>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Copy password"
      >
        {copied ? <CheckIcon className="size-4 text-green-600" /> : <CopyIcon className="size-4" />}
      </button>
    </div>
  );
}

// =============================================================================
// Email-delivery status line (shown beneath a generated password)
// =============================================================================

function EmailStatusLine({
  status,
  to,
}: {
  status: { emailed: boolean; emailError?: string };
  to: string;
}) {
  if (status.emailed) {
    return <p className="text-sm text-green-700">✓ Emailed to {to}</p>;
  }
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-amber-700">⚠ Couldn't email it automatically — copy and share manually.</p>
      {status.emailError && (
        <p className="text-xs text-muted-foreground">{status.emailError}</p>
      )}
    </div>
  );
}

// =============================================================================
// Role badge
// =============================================================================

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === 'admin' ? 'default' : 'secondary'} className="capitalize">
      {role}
    </Badge>
  );
}

// =============================================================================
// Relative time helper
// =============================================================================

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Pinned locale/zone: server (UTC) and client must format identically (hydration).
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC' });
}

// =============================================================================
// Main component
// =============================================================================

export function UsersPage({ users: initialUsers, currentEmail }: UsersPageProps) {
  const [users, setUsers] = useState(initialUsers);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  // Outcome of the best-effort MailLayer send that accompanies a generated password.
  const [emailStatus, setEmailStatus] = useState<{ emailed: boolean; emailError?: string } | null>(
    null
  );

  // Form state for Add / Edit dialogs
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'editor'>('editor');

  function openAdd() {
    setFormEmail('');
    setFormName('');
    setFormRole('editor');
    setError(null);
    setShownPassword(null);
    setEmailStatus(null);
    setDialog({ kind: 'add' });
  }

  function openEdit(user: AdminUser) {
    setFormName(user.name ?? '');
    setFormRole(user.role === 'admin' ? 'admin' : 'editor');
    setError(null);
    setDialog({ kind: 'edit', user });
  }

  function openReset(user: AdminUser) {
    setError(null);
    setShownPassword(null);
    setEmailStatus(null);
    setDialog({ kind: 'reset', user });
  }

  function openDelete(user: AdminUser) {
    setError(null);
    setDialog({ kind: 'delete', user });
  }

  function closeDialog() {
    if (shownPassword) {
      // Don't close while showing the one-time password — require explicit dismiss
      setShownPassword(null);
    }
    setDialog(null);
    setError(null);
    setShownPassword(null);
    setEmailStatus(null);
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createAdminUser({
        email: formEmail,
        name: formName || undefined,
        role: formRole,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      // Optimistic insert — the page will revalidate but we show the new row immediately.
      const newUser: AdminUser = {
        email: formEmail.trim().toLowerCase(),
        name: formName.trim() || formEmail.split('@')[0] || null,
        role: formRole,
        passwordHash: '***',
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      setUsers((prev) => [...prev, newUser]);
      setShownPassword(result.password ?? null);
      setEmailStatus({ emailed: !!result.emailed, emailError: result.emailError });
    });
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  function handleUpdate(userEmail: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateAdminUser(userEmail, { name: formName, role: formRole });
      if (result.error) {
        setError(result.error);
        return;
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.email === userEmail ? { ...u, name: formName.trim() || u.name, role: formRole } : u
        )
      );
      setDialog(null);
    });
  }

  // -----------------------------------------------------------------------
  // Reset password
  // -----------------------------------------------------------------------

  function handleReset(userEmail: string) {
    setError(null);
    startTransition(async () => {
      const result = await resetAdminUserPassword(userEmail);
      if (result.error) {
        setError(result.error);
        return;
      }
      setShownPassword(result.password ?? null);
      setEmailStatus({ emailed: !!result.emailed, emailError: result.emailError });
    });
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  function handleDelete(userEmail: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAdminUser(userEmail);
      if (result.error) {
        setError(result.error);
        return;
      }
      setUsers((prev) => prev.filter((u) => u.email !== userEmail));
      setDialog(null);
    });
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage who can log in to this admin. Admin users can edit settings; editors can
            edit content.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <PlusIcon className="size-4" />
          Add user
        </Button>
      </div>

      {/* Users table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.email}>
                  <TableCell className="font-medium">
                    {user.name || <span className="text-muted-foreground">—</span>}
                    {user.email === currentEmail && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {relativeTime(user.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {relativeTime(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(user)}
                        title="Edit user"
                      >
                        <PencilIcon className="size-3.5" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openReset(user)}
                        title="Reset password"
                      >
                        <KeyRoundIcon className="size-3.5" />
                        <span className="sr-only">Reset password</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openDelete(user)}
                        disabled={user.email === currentEmail}
                        title={user.email === currentEmail ? "Can't delete your own account" : 'Delete user'}
                      >
                        <Trash2Icon className="size-3.5" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ADD USER DIALOG                                                      */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={dialog?.kind === 'add'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          {shownPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>User created</DialogTitle>
                <DialogDescription>
                  {emailStatus?.emailed
                    ? "We've emailed this password to the user. It won't be shown again."
                    : "Share this password with the new user. It won't be shown again."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>One-time password</Label>
                <CopyablePassword password={shownPassword} />
                {emailStatus && (
                  <EmailStatusLine
                    status={emailStatus}
                    to={dialog?.kind === 'add' ? formEmail.trim().toLowerCase() : ''}
                  />
                )}
              </div>
              <DialogFooter>
                <Button onClick={closeDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add user</DialogTitle>
                <DialogDescription>
                  A random password will be generated. Share it with the new user so they can
                  log in and change it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="add-email">Email *</Label>
                  <Input
                    id="add-email"
                    type="email"
                    placeholder="user@example.com"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-name">Name</Label>
                  <Input
                    id="add-name"
                    placeholder="Jane Smith"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-role">Role</Label>
                  <Select
                    value={formRole}
                    onValueChange={(v) => setFormRole(v as 'admin' | 'editor')}
                  >
                    <SelectTrigger id="add-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor — can edit content</SelectItem>
                      <SelectItem value="admin">Admin — can edit content + settings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog} disabled={isPending}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isPending || !formEmail.trim()}>
                  {isPending ? 'Creating…' : 'Create user'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* EDIT USER DIALOG                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={dialog?.kind === 'edit'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'edit' ? dialog.user.email : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                placeholder="Jane Smith"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={formRole}
                onValueChange={(v) => setFormRole(v as 'admin' | 'editor')}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor — can edit content</SelectItem>
                  <SelectItem value="admin">Admin — can edit content + settings</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => dialog?.kind === 'edit' && handleUpdate(dialog.user.email)}
              disabled={isPending}
            >
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* RESET PASSWORD DIALOG                                                */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={dialog?.kind === 'reset'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          {shownPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Password reset</DialogTitle>
                <DialogDescription>
                  {emailStatus?.emailed ? (
                    <>
                      We've emailed the new password to{' '}
                      {dialog?.kind === 'reset' ? dialog.user.email : 'the user'}. It won't be shown
                      again.
                    </>
                  ) : (
                    <>
                      Share this new password with{' '}
                      {dialog?.kind === 'reset' ? dialog.user.email : 'the user'}. It won't be shown
                      again.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <CopyablePassword password={shownPassword} />
                {emailStatus && (
                  <EmailStatusLine
                    status={emailStatus}
                    to={dialog?.kind === 'reset' ? dialog.user.email : ''}
                  />
                )}
              </div>
              <DialogFooter>
                <Button onClick={closeDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset password?</DialogTitle>
                <DialogDescription>
                  Generate a new random password for{' '}
                  <strong>{dialog?.kind === 'reset' ? dialog.user.email : ''}</strong>. Their
                  current password will stop working immediately.
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog} disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => dialog?.kind === 'reset' && handleReset(dialog.user.email)}
                  disabled={isPending}
                >
                  {isPending ? 'Resetting…' : 'Reset password'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* DELETE USER DIALOG                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={dialog?.kind === 'delete'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              Remove <strong>{dialog?.kind === 'delete' ? dialog.user.email : ''}</strong> from
              this admin. They will no longer be able to log in. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => dialog?.kind === 'delete' && handleDelete(dialog.user.email)}
              disabled={isPending}
            >
              {isPending ? 'Deleting…' : 'Delete user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
