'use client';

import { MessageCircle } from 'lucide-react';

import { useLeagueSocialWidget } from '@/components/league/social/LeagueSocialWidgetProvider';
import type { SocialDiscussionContext } from '@/types/social';

interface LeagueSocialDiscussButtonProps {
  context: SocialDiscussionContext;
  leagueId?: string;
  className?: string;
  label?: string;
}

export function LeagueSocialDiscussButton({
  context,
  leagueId,
  className = '',
  label = 'Discuss',
}: LeagueSocialDiscussButtonProps): React.JSX.Element {
  const social = useLeagueSocialWidget();
  const targetLeagueId = leagueId ?? social.leagueId;
  const unavailable = !targetLeagueId;

  return (
    <button
      type="button"
      disabled={unavailable}
      onClick={() => {
        if (!targetLeagueId) return;
        social.open({
          leagueId: targetLeagueId,
          view: 'chat',
          context,
        });
      }}
      title={unavailable ? 'Select a league before starting a discussion' : undefined}
      aria-label={`${label}: ${context.title}`}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <MessageCircle className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
