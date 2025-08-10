import type { Player, RankedPlayer } from '@/types/players';

interface Props {
  injured: Player;
  replacements: RankedPlayer[];
}

export default function InjuryAlert({ injured, replacements }: Props) {
  if (!injured) return null;
  return (
    <div className="p-4 mb-4 border-l-4 border-red-500 bg-red-50">
      <p className="font-semibold">
        {injured.name} is out this week—here are 3 players to consider adding
      </p>
      <ul className="list-disc ml-6 mt-2">
        {replacements.map((p) => (
          <li key={p.id}>
            {p.name} ({p.team}) - {p.position}
          </li>
        ))}
      </ul>
    </div>
  );
}
