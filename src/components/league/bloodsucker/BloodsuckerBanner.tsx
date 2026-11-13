'use client';

import Link from 'next/link';

import { biteStatusLabel } from './bloodsuckerDisplay';
import type { BloodsuckerSummaryView } from './useBloodsuckerSummary';

/**
 * League home banner (BR-40): who the Bloodsucker is, its record, and every bite this season. The
 * Bloodsucker also gets a link to each bite it still has to make.
 */
export function BloodsuckerBanner({
  leagueId,
  summary,
  failed,
}: {
  leagueId: string;
  summary: BloodsuckerSummaryView | null;
  failed: boolean;
}) {
  if (failed) {
    return (
      <section
        aria-label="Bloodsucker"
        className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]"
      >
        The Bloodsucker&apos;s record could not load. Refresh to try again.
      </section>
    );
  }
  if (!summary || summary.leagueFormat !== 'BLOODSUCKER') return null;

  const { bloodsucker, record, bites, viewer } = summary;
  const openBites = viewer.isBloodsucker
    ? bites.filter((bite) => bite.status === 'OPEN' || bite.status === 'WAITING_LOCK')
    : [];

  return (
    <section
      aria-labelledby="bloodsucker-banner-title"
      className="rounded-lg border border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)] p-4 text-[color:var(--league-text)] sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-danger)]">
            Bloodsucker league
          </p>
          <h2 id="bloodsucker-banner-title" className="mt-1 text-lg font-semibold">
            {bloodsucker ? (
              <>
                The Bloodsucker is {bloodsucker.teamName}
                {viewer.isBloodsucker ? ' (you)' : ''}
              </>
            ) : (
              'No Bloodsucker yet'
            )}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            {bloodsucker
              ? `Record ${record.wins}-${record.losses}-${record.draws} (won, lost, drawn). Every team it beats gives up a player.`
              : 'The commissioner chooses or draws the Bloodsucker before the draft.'}
          </p>
        </div>
        {openBites.map((bite) => (
          <Link
            key={bite.biteId}
            href={`/leagues/${encodeURIComponent(leagueId)}/bites/${encodeURIComponent(bite.biteId)}`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-[color:var(--league-danger)] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-text)] focus-visible:ring-offset-2"
          >
            Bite {bite.victim.teamName} (round {bite.round})
          </Link>
        ))}
      </div>

      {bloodsucker ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Bites this season</h3>
          {bites.length === 0 ? (
            <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">No bites yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[color:var(--league-border)] text-sm">
              {bites.map((bite) => (
                <li key={bite.biteId} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
                  <span className="font-medium sm:w-20">Round {bite.round}</span>
                  <span className="min-w-0 flex-1">
                    {bite.takenPlayer && bite.returnedPlayer
                      ? `Took ${bite.takenPlayer.name} from ${bite.victim.teamName}, sent back ${bite.returnedPlayer.name}`
                      : `${bite.victim.teamName}: ${biteStatusLabel(bite.status).toLowerCase()}`}
                  </span>
                  {bite.takenPlayer ? (
                    <span className="text-[color:var(--league-text-muted)]">
                      {biteStatusLabel(bite.status)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
