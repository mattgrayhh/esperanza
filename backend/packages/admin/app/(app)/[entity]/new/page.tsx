// "New record" route: /<segment>/new. Confirms then creates a fresh record via the
// createEntity server action and redirects to its editor. Kept as an explicit confirm
// step (rather than auto-creating on navigation) so an accidental click doesn't litter
// empty rows.
//
// Re-skinned with shadcn (Card/Button). The create() server action (createEntity +
// redirect) is UNCHANGED.
import { notFound, redirect } from 'next/navigation';
import { ENTITY_LIST, singularizeLabel } from '@/lib/entities';
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

function bySegment(segment: string) {
  return ENTITY_LIST.find((e) => e.segment === segment);
}

export default async function NewEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  const def = bySegment(entity);
  if (!def) notFound();

  async function create() {
    'use server';
    const res = await createEntity(def!.key);
    if (res.ok) redirect(`/${def!.segment}/${res.id}`);
    throw new Error(res.error);
  }

  const singular = singularizeLabel(def.label);

  return (
    <Card size="default" className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">New {singular}</CardTitle>
        <CardDescription>
          Creates a blank {singular} record (unpublished). You can fill in fields and publish it
          from the editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={create} className="flex gap-3">
          <Button type="submit">Create record</Button>
          <Button render={<a href={`/${def.segment}`}>Cancel</a>} variant="outline" />
        </form>
      </CardContent>
    </Card>
  );
}
