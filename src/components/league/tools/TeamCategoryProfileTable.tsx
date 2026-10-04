import Link from 'next/link';

import type { TeamCategoryProfile } from '@/server/leagues/teamCategoryProfile';

const ordinal = (value: number) => {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th');
  return `${value}${suffix}`;
};

/** Where the viewer's team wins and loses categories, per round, against the rest of the league. */
export function TeamCategoryProfileTable({
  leagueId,
  profile,
}: {
  leagueId: string;
  profile: TeamCategoryProfile;
}) {
  const rosterHref = `/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(profile.memberId)}`;

  if (profile.categories.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">{profile.teamName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your category profile appears after your first completed round.
        </p>
        <Link
          href={rosterHref}
          className="mt-4 inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View your roster
        </Link>
      </section>
    );
  }

  const ranked = [...profile.categories].sort((a, b) => a.rank - b.rank);
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  const rankSummary =
    strongest.rank === weakest.rank
      ? `Ranked ${ordinal(strongest.rank)} of ${profile.teamCount} in every category.`
      : `Strongest: ${strongest.label} (${ordinal(strongest.rank)}). Weakest: ${weakest.label} (${ordinal(weakest.rank)}).`;

  return (
    <section
      aria-labelledby="team-profile-heading"
      className="rounded-lg border border-border bg-background"
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="team-profile-heading" className="text-base font-semibold text-foreground">
            {profile.teamName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-round averages over {profile.roundsPlayed} completed{' '}
            {profile.roundsPlayed === 1 ? 'round' : 'rounds'}. {rankSummary}
          </p>
        </div>
        <Link
          href={rosterHref}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View your roster
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {profile.teamName} category averages and league rank
          </caption>
          <thead className="text-xs font-semibold uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2">
                Category
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                You
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                League avg
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                Rank
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {profile.categories.map((category) => (
              <tr key={category.key} className="border-t border-border">
                <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                  {category.label}
                  {category.lowWins ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      Lower wins
                    </span>
                  ) : null}
                </th>
                <td className="px-4 py-3 text-right font-semibold text-foreground">
                  {category.average}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {category.leagueAverage}
                </td>
                <td className="px-4 py-3 text-right text-foreground">
                  {ordinal(category.rank)}
                  <span className="text-muted-foreground"> of {profile.teamCount}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
