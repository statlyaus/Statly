'use client';

import { X } from 'lucide-react';
import { useEffect, useId } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';

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
      className="fixed inset-x-0 bottom-0 z-[60] flex h-[72dvh] flex-col rounded-cut-float border-[2.5px] border-foreground bg-card text-foreground shadow-hard sm:inset-y-0 sm:left-auto sm:h-full sm:w-[min(42rem,48vw)] sm:rounded-none sm:border-y-0 sm:border-r-0"
    >
      <h2 id={titleId} className="sr-only">
        League social
      </h2>
      <button
        type="button"
        onClick={onClose}
        className={cn(buttonStyles(), 'absolute right-16 top-3 z-20 size-11 px-0')}
        aria-label="Close league social"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      <LeagueSocialShell
        leagueId={leagueId}
        currentUserId={currentUserId}
        view={initialView}
        className="h-full min-h-0 rounded-none border-0 shadow-none"
      />
    </aside>
  );
}
