import RoundMatches from '@/components/RoundMatches';
import { AppLayout } from '@/components/navigation';

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
  return (
    <AppLayout>
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold">Round {roundNumber} Matches</h1>
        <RoundMatches round={roundNumber} />
      </main>
    </AppLayout>
  );
}
