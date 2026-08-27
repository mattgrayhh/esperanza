'use client';

// =============================================================================
// DeleteEntityButton — destructive "Delete" action on the record edit header.
//
// Confirms in a shadcn Dialog (showing the record name), calls the generic
// deleteEntity server action, then navigates back to the entity list. For
// Snowflake-synced entities (qmi/communities/floor_plans) it warns that the row
// will reappear on the next sync and that Draft is usually what they want.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2Icon } from 'lucide-react';
import { deleteEntity } from '../lib/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function DeleteEntityButton({
  entityKey,
  id,
  segment,
  displayName,
  synced,
  onResult,
}: {
  entityKey: string;
  id: string;
  segment: string;
  displayName: string;
  /** true for Snowflake-synced entities (qmi/communities/floor_plans). */
  synced: boolean;
  onResult?: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      const res = await deleteEntity(entityKey, id);
      if (res.ok) {
        setOpen(false);
        router.push(`/${segment}`);
        router.refresh();
      } else {
        onResult?.(`Error: ${res.error}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        <Trash2Icon /> Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{displayName}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the record and takes it off the live site. This can’t be undone.
            {synced ? (
              <>
                {' '}
                <strong>Heads up:</strong> this record is synced from Snowflake and will
                reappear on the next sync. To hide it on the site, set its status to{' '}
                <strong>Draft</strong> instead.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
