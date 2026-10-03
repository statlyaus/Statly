import { TeamMark } from '@/components/scores/MatchupScore';
import type { League, LeagueMember } from '@/types/leagues';

interface LeagueHeaderProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

/** League identity shown above the section tabs on every league tab. */
export function LeagueHeader({
  league,
  members,
  currentUserId,
}: LeagueHeaderProps): React.JSX.Element {
  const activeMembers = members.filter((member) => member.isActive !== false);
  const viewer = currentUserId
    ? activeMembers.find((member) => member.userId === currentUserId)
    : undefined;
  const isCommissioner =
    viewer !== undefined &&
    (viewer.role === 'owner' ||
      viewer.userId === league.ownerId ||
      viewer.isCoCommissioner === true);
  const meta = [
    league.type === 'private' ? 'Private' : 'Public',
    `${activeMembers.length} of ${league.maxTeams} teams`,
  ];

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate font-display text-3xl font-bold leading-tight text-foreground">
          {league.name}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{meta.join(' · ')}</p>
      </div>
      {viewer ? (
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamMark teamName={viewer.teamName} logoUrl={viewer.teamLogoUrl ?? null} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{viewer.teamName}</p>
            <p className="text-xs text-muted-foreground">
              {isCommissioner ? 'Your team · Commissioner' : 'Your team'}
            </p>
          </div>
        </div>
      ) : null}
    </header>
  );
}
