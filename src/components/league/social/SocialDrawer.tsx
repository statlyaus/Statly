'use client';

import { X } from 'lucide-react';
import { useEffect, useId } from 'react';

import LeagueSocialShell, { type LeagueSocialView } from './LeagueSocialShell';

interface SocialDrawerProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  currentUserId?: string;
  initialView?: LeagueSocialView;
}

export default function SocialDrawer({
  open,
  onClose,
  leagueId,
  currentUserId,
  initialView = 'chat',
}: SocialDrawerProps): React.JSX.Element {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return <></>;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="league-social fixed inset-x-0 bottom-0 z-[60] flex h-[72dvh] flex-col rounded-t-3xl border border-social-border bg-social-surface text-social-text shadow-2xl sm:inset-y-0 sm:left-auto sm:h-full sm:w-[min(42rem,48vw)] sm:rounded-none sm:border-y-0 sm:border-r-0"
    >
      <h2 id={titleId} className="sr-only">
        League social
      </h2>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-16 top-3 z-20 inline-flex size-10 items-center justify-center rounded-full border border-social-border bg-social-surface text-social-text-muted shadow-sm transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
        aria-label="Close league social"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      <LeagueSocialShell
        leagueId={leagueId}
        currentUserId={currentUserId}
        initialView={initialView}
        className="h-full min-h-0 rounded-none border-0 shadow-none"
      />
    </aside>
  );
}
