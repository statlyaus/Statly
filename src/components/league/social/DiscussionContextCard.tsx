'use client';

import { X } from 'lucide-react';

import type { SocialDiscussionContext } from '@/types/social';

export default function DiscussionContextCard({
  context,
  label = 'Context',
  onRemove,
}: {
  context: SocialDiscussionContext;
  label?: string;
  onRemove?: () => void;
}): React.JSX.Element {
  const metadata = Object.values(context.metadata ?? {}).filter(Boolean);

  return (
    <div className="ground-white my-1 bg-card p-3 text-foreground ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-primary">
            {label}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-foreground">{context.title}</p>
          {context.subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{context.subtitle}</p>
          ) : null}
          {metadata.length > 0 ? (
            <p className="mt-1 break-words text-xs text-muted-foreground">{metadata.join(' · ')}</p>
          ) : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-cut text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove discussion context"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
