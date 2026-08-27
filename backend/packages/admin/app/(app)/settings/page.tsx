// /settings → redirect to the primary Settings surface.
//
// Current Settings surfaces:
//   /settings/fields     — Field Builder (Full-Admin)
//   /settings/pdf-theme  — PDF Theme editor (Full-Admin)
//
// Redirecting to /settings/fields as the landing page; the PDF Theme surface is
// reachable from the sidebar or directly at /settings/pdf-theme.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SettingsIndex() {
  redirect('/settings/fields');
}
