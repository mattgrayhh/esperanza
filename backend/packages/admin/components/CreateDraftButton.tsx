'use client';

// Submit control for createCommunityDraft (and similar create form actions).
// useFormStatus gives immediate pending feedback while the server action runs.

import { useFormStatus } from 'react-dom';
import { Loader2Icon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CreateDraftButton({
  label = 'New',
  'aria-label': ariaLabel,
}: {
  label?: string;
  'aria-label'?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-label={ariaLabel ?? label} aria-busy={pending}>
      {pending ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
      {pending ? 'Creating…' : label}
    </Button>
  );
}

/** Icon-only variant for dense rows (dashboard collections jump). */
export function CreateDraftIconButton({
  'aria-label': ariaLabel,
  className,
}: {
  'aria-label': string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      aria-busy={pending}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] duration-150 hover:bg-background hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
        pending ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        className
      )}
    >
      {pending ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <PlusIcon className="size-4" />
      )}
    </button>
  );
}
