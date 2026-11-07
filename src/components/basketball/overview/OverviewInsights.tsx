import Link from 'next/link';

import { getBasketballCategory } from '@/types/basketball';
import type { MatchupView } from '@/server/basketball/readModels/matchupModel';
import type { PickupsView } from '@/server/basketball/readModels/pickupsModel';

import { CallChip } from '../analysis/AnalysisBits';
import { formatChance, formatSigned } from '../analysis/format';
import { textLinkStyles } from '@/components/ui/controlStyles';
import { basketballLeagueHref } from '../shell/basketballFormat';

const TOP_PICKUPS = 5;

function MatchupOdds({ matchup, leagueId }: { matchup: MatchupView; leagueId: string }) {
  if (matchup.status !== 'READY') return null;
  const { projection } = matchup;
  const { wins, losses, tossUps } = projection.calls;
  // Closest categories first: where a streaming add or a lineup decision can still swing the week.
  const closest = [...projection.categories]
    .sort((a, b) => Math.abs(a.winChance - 0.5) - Math.abs(b.winChance - 0.5))
    .slice(0, 3);

  return (
    <section
      aria-labelledby="overview-odds-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="overview-odds-heading" className="font-display text-lg font-bold text-foreground">
        Projected result
      </h2>
      {projection.outcome ? (
        <p className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">
          {formatChance(projection.outcome.win)}
          <span className="ml-1.5 font-sans text-sm font-medium text-muted-foreground">
            chance to win the week
            {projection.outcome.tie > 0 ? `, ${formatChance(projection.outcome.tie)} to tie` : ''}
          </span>
        </p>
      ) : (
        <p className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">
          {projection.expectedCategoriesWon.toFixed(1)}–
          {projection.expectedCategoriesLost.toFixed(1)}
          <span className="ml-1.5 font-sans text-sm font-medium text-muted-foreground">
            expected category record
          </span>
        </p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">
        Projected calls: {wins} won, {losses} lost, {tossUps} too close to call.
      </p>
      <h3 className="mt-3 text-sm font-semibold text-foreground">Closest categories</h3>
      <ul className="mt-1 flex flex-col gap-1.5 text-sm">
        {closest.map((category) => (
          <li key={category.category} className="flex items-center gap-2">
            <CallChip call={category.call} />
            <span className="font-semibold text-foreground">
              {getBasketballCategory(category.category).shortLabel}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatChance(category.winChance)} to win
            </span>
          </li>
        ))}
      </ul>
      <Link
        href={basketballLeagueHref(leagueId, 'matchup')}
        className={`${textLinkStyles} mt-3 inline-block text-sm`}
      >
        Every category
      </Link>
    </section>
  );
}

function TopPickups({ pickups, leagueId }: { pickups: PickupsView; leagueId: string }) {
  if (pickups.status !== 'READY') return null;
  const options = pickups.options.slice(0, TOP_PICKUPS);

  return (
    <section
      aria-labelledby="overview-pickups-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="overview-pickups-heading" className="font-display text-lg font-bold text-foreground">
        Best adds this week
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {pickups.drop
          ? `If you drop ${pickups.drop.fullName}. Adds count from tomorrow.`
          : 'Using an open roster spot. Adds count from tomorrow.'}
      </p>
      {options.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No free agent improves this week&apos;s projection.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col divide-y divide-border text-sm">
          {options.map((option) => (
            <li key={option.player.playerId} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                {option.player.fullName}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {option.player.teamCode ?? 'FA'}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {option.gamesAdded} {option.gamesAdded === 1 ? 'game' : 'games'}
              </span>
              <span className="w-20 text-right font-semibold tabular-nums text-foreground">
                {formatSigned(option.categoryChange, 1)} cats
              </span>
            </li>
          ))}
        </ol>
      )}
      <Link
        href={basketballLeagueHref(leagueId, 'pickups')}
        className={`${textLinkStyles} mt-3 inline-block text-sm`}
      >
        All pickups
      </Link>
    </section>
  );
}

/** The week's projected result and the best streaming adds, from the Matchup and Pickups models. */
export function OverviewInsights({
  matchup,
  pickups,
  leagueId,
}: {
  matchup: MatchupView;
  pickups: PickupsView;
  leagueId: string;
}) {
  if (matchup.status !== 'READY' && pickups.status !== 'READY') return null;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <MatchupOdds matchup={matchup} leagueId={leagueId} />
      <TopPickups pickups={pickups} leagueId={leagueId} />
    </div>
  );
}
