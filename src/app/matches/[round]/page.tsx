import Link from 'next/link';

import { AppLayout } from '@/components/navigation';
import MatchesClient from './MatchesClient';
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
      <AppLayout>
        <main className="mx-auto max-w-5xl p-4">
          <h1 className="mb-4 text-2xl font-semibold text-red-600">Invalid round parameter.</h1>
        </main>
      </AppLayout>
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
    <AppLayout>
      <main className="mx-auto max-w-5xl p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h1 className="text-2xl font-semibold">Round {roundNumber} Matches</h1>
          <Link href="/matches" className="text-sm text-blue-600 hover:text-blue-700">
            Back to Live Center
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <Link
            href={`/matches/${prevRound}`}
            aria-disabled={roundNumber <= 1}
            className={`px-3 py-1 rounded border text-sm ${roundNumber <= 1 ? 'pointer-events-none opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
            onClick={roundNumber <= 1 ? (e) => e.preventDefault() : undefined}
          >
            ← Previous
          </Link>
          <Link
            href={`/matches/${nextRound}`}
            className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
          >
            Next →
          </Link>
        </div>

        <MatchesClient round={roundNumber} initialMatches={initialMatches as any} />
      </main>
    </AppLayout>
  );
}
