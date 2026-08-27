'use client';

// =============================================================================
// ExpandableDescription — clamp-to-N-lines copy with a Read more/less toggle. Adapted
// verbatim from bundui real-estate/detail. Presentational only.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ExpandableDescription({
  text,
  collapsedLines = 7,
}: {
  text: string;
  collapsedLines?: number;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (!textRef.current) return;
      setIsOverflowing(textRef.current.scrollHeight > textRef.current.clientHeight);
    };
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [text, isExpanded]);

  return (
    <div className="space-y-2">
      <p
        ref={textRef}
        className="leading-7 whitespace-pre-line text-muted-foreground"
        style={
          isExpanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: collapsedLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {text}
      </p>
      {isOverflowing ? (
        <Button
          variant="link"
          size="sm"
          className="px-0"
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? 'Read less' : 'Read more'}
        </Button>
      ) : null}
    </div>
  );
}
