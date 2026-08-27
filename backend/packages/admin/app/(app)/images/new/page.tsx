// =============================================================================
// IMAGES "new record" route: /images/new.
//
// The bespoke static /images segment (app/images/page.tsx + app/images/[id]/page.tsx)
// SHADOWS the dynamic /[entity] route for `images`. Without this file, /images/new
// would fall through to /images/[id] with id="new" → buildEditView('images','new')
// returns null → 404. The dashboard's per-entity "+ New" link points at /images/new,
// so this thin wrapper is required so that path does not 404.
//
// The DAM's primary creation path is the upload dropzone on /images (createImageAsset,
// which makes the row AND populates file_url in one step). This page is the metadata-
// first fallback: it reuses the EXISTING createEntity server action (no new write path)
// exactly like the generic app/[entity]/new/page.tsx, then redirects into the generic
// /images/{id} editor where the operator uploads the file via the inline ImageUploader.
// =============================================================================

import { redirect } from 'next/navigation';
import { createEntity } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default function NewImagePage() {
  async function create() {
    'use server';
    const res = await createEntity('images');
    if (res.ok) redirect(`/images/${res.id}`);
    throw new Error(res.error);
  }

  return (
    <Card size="default" className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">New Image asset</CardTitle>
        <CardDescription>
          Fastest path: drag files onto the upload dropzone on the Images page. Or create a blank
          asset record here and upload the file from its editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={create} className="flex gap-3">
          <Button type="submit">Create blank asset</Button>
          <Button render={<a href="/images">Back to library</a>} variant="outline" />
        </form>
      </CardContent>
    </Card>
  );
}
