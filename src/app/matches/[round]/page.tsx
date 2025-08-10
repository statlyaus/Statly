import RoundMatchesBanner from '@/components/RoundMatchesBanner';

export default function RoundMatchesPage({
  params,
}: {
  params: { round: string };
}) {
  const roundNumber = Number(params.round);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Round {roundNumber} Matches</h1>
      <RoundMatchesBanner round={roundNumber} />
    </main>
  );
}
