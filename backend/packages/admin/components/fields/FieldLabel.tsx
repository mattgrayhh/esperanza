'use client';

import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function FieldHelpTooltip({ help }: { help: string }) {
  const text = help.trim();
  if (!text) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="More info"
          />
        }
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-sm text-left">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function FieldLabel({
  label,
  help,
  className,
  children,
}: {
  label: string;
  help?: string;
  className?: string;
  children?: ReactNode;
}) {
  const hasHelp = Boolean(help?.trim());

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {label ? <Label className="font-medium text-foreground">{label}</Label> : null}
      {hasHelp ? <FieldHelpTooltip help={help!} /> : null}
      {children}
    </div>
  );
}
