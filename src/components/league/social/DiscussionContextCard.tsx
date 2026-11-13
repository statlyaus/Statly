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
    <div className="my-1 rounded-xl bg-social-surface p-3 text-social-text shadow-sm ring-1 ring-social-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-social-link">
            {label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-social-text">{context.title}</p>
          {context.subtitle ? (
            <p className="mt-1 text-xs text-social-text-muted">{context.subtitle}</p>
          ) : null}
          {metadata.length > 0 ? (
            <p className="mt-1 truncate text-xs text-social-text-muted">{metadata.join(' · ')}</p>
          ) : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            aria-label="Remove discussion context"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
