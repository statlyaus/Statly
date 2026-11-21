'use client';

import { MessageCircle } from 'lucide-react';

import { useLeagueSocialWidget } from '@/components/league/social/LeagueSocialWidgetProvider';
import type { SocialDiscussionContext } from '@/types/social';
import { buttonStyles } from '@/components/ui/controlStyles';

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
      className={`${buttonStyles({ variant: 'outline', size: 'xs' })} ${className}`}
    >
      <MessageCircle className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
