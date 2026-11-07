import { badgeStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';
import type { BasketballPlayerInjuryDto } from '@/server/basketball/leagues/basketballLeagueDto';

import { formatEasternDate } from './basketballFormat';

/** Injury report status as a word, never colour alone: OUT or DTD, with the detail as its name. */
export function InjuryBadge({ injury }: { injury: BasketballPlayerInjuryDto }) {
  const out = injury.status === 'OUT';
  const description = [
    out ? 'Out' : 'Day to day',
    injury.detail,
    injury.expectedReturnOn ? `expected back ${formatEasternDate(injury.expectedReturnOn)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className={badgeStyles({ tone: out ? 'loss' : 'warning', size: 'xs' })}
      title={description}
      aria-label={`Injury report: ${description}`}
    >
      {out ? 'OUT' : 'DTD'}
    </span>
  );
}

export function InjuredListBadge() {
  return (
    <span className={badgeStyles({ tone: 'muted', size: 'xs' })} aria-label="On injured list">
      IL
    </span>
  );
}

/** Player name with NBA team and positions under it, and any injury or IL badge beside the name. */
export function PlayerIdentity({
  fullName,
  teamCode,
  positions,
  injury,
  onInjuredList = false,
  className,
}: {
  fullName: string;
  teamCode: string | null;
  positions: string[];
  injury: BasketballPlayerInjuryDto | null;
  onInjuredList?: boolean;
  className?: string;
}) {
  const detail = [teamCode ?? 'No team', positions.join(', ')].filter(Boolean).join(' · ');
  return (
    <span className={cn('flex min-w-0 flex-col', className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold text-foreground">{fullName}</span>
        {injury ? <InjuryBadge injury={injury} /> : null}
        {onInjuredList ? <InjuredListBadge /> : null}
      </span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  );
}
