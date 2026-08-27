// =============================================================================
// Settings → Users — user management. FULL-ADMIN gated.
//
// Server component: gates on role === 'admin', reads the full admin_users list
// from D1, and hands it to the client UsersPage. Mutations (create / update /
// reset password / delete) go through server actions in lib/user-actions.ts.
// =============================================================================

import { isAdmin, getCurrentUserOrNull } from '@/lib/auth';
import { listAdminUsers } from '@/lib/user-actions';
import { UsersPage } from '@/components/users/UsersPage';
import { ShieldAlertIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  if (!(await isAdmin())) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 py-24 text-center">
        <ShieldAlertIcon className="size-10 text-muted-foreground" />
        <h1 className="font-heading text-xl font-bold text-foreground">403 — Full Admin only</h1>
        <p className="text-sm text-muted-foreground">
          User management is restricted to Full Admins.
        </p>
      </div>
    );
  }

  const [users, currentEmail] = await Promise.all([
    listAdminUsers(),
    getCurrentUserOrNull(),
  ]);

  return <UsersPage users={users} currentEmail={currentEmail ?? ''} />;
}
