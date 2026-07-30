import { RoundMatches } from '@/components/RoundMatches';
import Link from 'next/link';
import { adminDb } from '@/lib/firebaseAdmin';
import { mapMatchEventToDTO } from '@/lib/matchMapper';

export default async function RoundMatchesPage({ params }: { params: Promise<{ round: string }> }) {
  const { round } = await params;
  const roundNumber = Number(round);
  const isValidRound =
    typeof round === 'string' &&
    round.trim() !== '' &&
    Number.isInteger(Number(round)) &&
    Number(round) > 0;

  if (!isValidRound) {
    return (
        <main className="mx-auto max-w-5xl p-4">
          <h1 className="mb-4 text-2xl font-semibold text-red-600">Invalid round parameter.</h1>
        </main>
    );
  }

  const prevRound = Math.max(1, roundNumber - 1);
  const nextRound = roundNumber + 1;

  // Preload initial matches on the server for faster render
  let initialMatches: ReturnType<typeof mapMatchEventToDTO>[] = [];

  try {
    const snapshot = await adminDb.collection('MatchEvent').where('round', '==', roundNumber).get();

    type MatchEvent = {
      matchDate?: { toDate: () => Date } | Date | null;
      homeTeam: string;
      awayTeam: string;
      scoreHome?: number | null;
      scoreAway?: number | null;
      round: number;
    };

    initialMatches = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        // Validate required fields exist
        if (!data.homeTeam || !data.awayTeam || typeof data.round !== 'number') {
          console.warn(`Invalid match data for doc ${doc.id}`);
          return null;
        }
        return mapMatchEventToDTO(doc.id, data as MatchEvent);
      })
      .filter((m): m is ReturnType<typeof mapMatchEventToDTO> => m !== null);
  } catch (_e) {
    console.error('Failed to preload matches for round', roundNumber, _e);
  }

  return (
      <main className="mx-auto max-w-5xl p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h1 className="text-2xl font-semibold">Round {roundNumber} Matches</h1>
          <Link href="/matches" className="text-sm text-blue-600 hover:text-blue-700">
            Back to Live Center
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {roundNumber <= 1 ? (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded border px-3 py-1 text-sm opacity-50"
            >
              ← Previous
            </button>
          ) : (
            <Link
              href={`/matches/${prevRound}`}
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
            >
              ← Previous
            </Link>
          )}
          <Link
            href={`/matches/${nextRound}`}
            className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
          >
            Next →
          </Link>
        </div>

        <RoundMatches round={roundNumber} initialMatches={initialMatches} />
      </main>
  );
}
