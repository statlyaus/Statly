// src/app/rankings/RankingsTable.tsx
export type PlayerRow = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
};

type Props = {
  players: PlayerRow[];
};

export default function RankingsTable({ players }: Props) {
  return (
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Team</th>
          <th>Total Value</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.id}>
            <td>{p.rank}</td>
            <td>{p.name}</td>
            <td>{p.team ?? '-'}</td>
            <td>{p.totalValue.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
