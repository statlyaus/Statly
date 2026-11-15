'use client';

import Link from 'next/link';

import { biteStatusLabel, isBiteOpen } from './bloodsuckerDisplay';
import type { BloodsuckerSummaryView } from './useBloodsuckerSummary';

type Bite = BloodsuckerSummaryView['bites'][number];

const MUTED = 'text-sm text-[color:var(--league-text-muted)]';
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-text)] focus-visible:ring-offset-2';

/**
 * The Bloodsucker banner (BR-40, #1343): who the Bloodsucker is, its record, and every bite this
 * season. It is on every league tab: in full on the overview and `compact` (no record line, no
 * bite list) elsewhere, so the Bloodsucker always has the link to a bite it must make, the victim
 * always sees its team is held, and a commissioner outside a bite reaches cancel and redo (BR-35).
 */
export function BloodsuckerBanner({
  leagueId,
  summary,
  failed,
  compact = false,
}: {
  leagueId: string;
  summary: BloodsuckerSummaryView | null;
  failed: boolean;
  compact?: boolean;
}) {
  if (!summary) {
    return failed && !compact ? (
      <section
        aria-label="Bloodsucker"
        className={`rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 ${MUTED}`}
      >
        The Bloodsucker&apos;s record could not load. Refresh to try again.
      </section>
    ) : null;
  }
  if (summary.leagueFormat !== 'BLOODSUCKER') return null;

  const { bloodsucker, record, bites, viewer } = summary;
  const biteHref = (bite: Bite) =>
    `/leagues/${encodeURIComponent(leagueId)}/bites/${encodeURIComponent(bite.biteId)}`;
  const openBites = bites.filter((bite) => isBiteOpen(bite.status));
  const bitesToMake = viewer.isBloodsucker ? openBites : [];
  const bitesOnViewer = openBites.filter((bite) => bite.victim.memberId === viewer.memberId);

  return (
    <section
      aria-labelledby="bloodsucker-banner-title"
      className={`rounded-lg border border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)] text-[color:var(--league-text)] ${compact ? 'p-3' : 'p-4 sm:p-5'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-danger)]">
            Bloodsucker league
          </p>
          <h2
            id="bloodsucker-banner-title"
            className={`mt-1 font-semibold ${compact ? 'text-base' : 'text-lg'}`}
          >
            {bloodsucker ? (
              <>
                The Bloodsucker is {bloodsucker.teamName}
                {viewer.isBloodsucker ? ' (you)' : ''}
              </>
            ) : (
              'No Bloodsucker yet'
            )}
          </h2>
          {compact ? null : (
            <p className={`mt-1 ${MUTED}`}>
              {bloodsucker
                ? `Record ${record.wins}-${record.losses}-${record.draws} (won, lost, drawn). Every team it beats gives up a player.`
                : 'The commissioner chooses or draws the Bloodsucker before the draft.'}
            </p>
          )}
          {bitesOnViewer.map((bite) => (
            <p key={bite.biteId} className="mt-2 text-sm font-medium">
              The Bloodsucker has a bite waiting on your team (round {bite.round}). Until it is
              made, your drops and trades are held.
            </p>
          ))}
          {failed ? (
            <p className={`mt-2 ${MUTED}`}>
              This could not refresh just now, so it may be out of date.
            </p>
          ) : null}
        </div>
        {bitesToMake.map((bite) => (
          <Link
            key={bite.biteId}
            href={biteHref(bite)}
            className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-[color:var(--league-danger)] px-4 text-sm font-semibold text-white ${FOCUS}`}
          >
            Bite {bite.victim.teamName} (round {bite.round})
          </Link>
        ))}
      </div>

      {bloodsucker && !compact ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Bites this season</h3>
          {bites.length === 0 ? (
            <p className={`mt-1 ${MUTED}`}>No bites yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[color:var(--league-border)] text-sm">
              {bites.map((bite) => (
                <li
                  key={bite.biteId}
                  className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:gap-3"
                >
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
                  {bite.commissionerActions.length > 0 ? (
                    <CommissionerLink href={biteHref(bite)} bite={bite} />
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

/** BR-35: only shown to a commissioner the server would let act on this bite. */
function CommissionerLink({ href, bite }: { href: string; bite: Bite }) {
  const verb = bite.commissionerActions.includes('redo') ? 'Cancel or redo' : 'Cancel';
  return (
    <Link
      href={href}
      aria-label={`${verb} the round ${bite.round} bite on ${bite.victim.teamName}`}
      className={`inline-flex min-h-11 items-center self-start rounded-md font-semibold underline underline-offset-2 sm:self-auto ${FOCUS}`}
    >
      {verb}
    </Link>
  );
}
