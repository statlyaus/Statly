'use client';

export type PlayerRow = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
};

export type Props = {
  players: PlayerRow[];
};

export default function RankingsTable({ players }: Props) {
  if (!players?.length) return <div>No players found.</div>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">#</th>
          <th className="py-2">Player</th>
          <th className="py-2">Team</th>
          <th className="py-2">Pos</th>
          <th className="py-2">Value</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.id} className="border-b">
            <td className="py-2">{p.rank}</td>
            <td className="py-2">{p.name}</td>
            <td className="py-2">{p.team ?? '—'}</td>
            <td className="py-2">{p.position ?? '—'}</td>
            <td className="py-2">{p.totalValue.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}