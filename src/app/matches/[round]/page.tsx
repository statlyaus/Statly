import RoundMatches from '@/components/RoundMatches';

export default function RoundMatchesPage({ params }: { params: { round: string } }) {
  const roundNumber = Number(params.round);
  const isValidRound =
    typeof params.round === 'string' &&
    params.round.trim() !== '' &&
    Number.isInteger(Number(params.round)) &&
    Number(params.round) > 0;

  if (!isValidRound) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold text-red-600">Invalid round parameter.</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Round {roundNumber} Matches</h1>
      <RoundMatches round={roundNumber} />
    </main>
  );
}
