import { RoundMatches } from '@/components/RoundMatches';
import Link from 'next/link';
import {
  mapRoundFixture,
  parseFixtureRound,
  parseFixtureSeason,
  type RoundMatchDTO,
} from '@/lib/matchMapper';
import { getRoundMatchesResult } from '@/server/etl/etlRoundData';

export default async function RoundMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ round: string }>;
  searchParams: Promise<{ season?: string | string[] }>;
}) {
  const { round } = await params;
  const { season: seasonParam } = await searchParams;
  const roundNumber = parseFixtureRound(round);

  if (roundNumber === null) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold text-red-600">Invalid round parameter.</h1>
      </div>
    );
  }

  const chosenSeason = typeof seasonParam === 'string' ? seasonParam : undefined;
  const season = parseFixtureSeason(chosenSeason, new Date());
  if (season === null) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold text-red-600">Invalid season parameter.</h1>
      </div>
    );
  }

  const seasonQuery = chosenSeason ? `?season=${season}` : '';
  const prevRound = Math.max(0, roundNumber - 1);
  const nextRound = roundNumber + 1;

  // Preload the round's fixture (Firestore `matches`, written by the ETL) for a faster render. A
  // failed read leaves it empty and RoundMatches reports the error from /api/matches.
  let initialMatches: RoundMatchDTO[] = [];
  const result = await getRoundMatchesResult(season, roundNumber);
  if (result.ok) initialMatches = mapRoundFixture(result.matches);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-2xl font-semibold">Round {roundNumber} Matches</h1>
        <Link href="/matches" className="text-sm text-blue-600 hover:text-blue-700">
          Back to Live Center
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {roundNumber <= 0 ? (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded border px-3 py-1 text-sm opacity-50"
          >
            ← Previous
          </button>
        ) : (
          <Link
            href={`/matches/${prevRound}${seasonQuery}`}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
          >
            ← Previous
          </Link>
        )}
        <Link
          href={`/matches/${nextRound}${seasonQuery}`}
          className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
        >
          Next →
        </Link>
      </div>

      <RoundMatches round={roundNumber} season={season} initialMatches={initialMatches} />
    </div>
  );
}
