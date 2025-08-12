import { notFound } from 'next/navigation';
import Table from '@/components/Table';
import { fetchFromAPI } from '@/lib/api';

interface LeagueTeam {
  id: string;
  name: string;
  manager: string;
}

interface League {
  id: string;
  name: string;
  teams: LeagueTeam[];
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let league: League | null = null;
  try {
    league = await fetchFromAPI<League>(`/api/leagues/${id}`);
  } catch {
    // ignore
  }
  if (!league) notFound();
  return (
    <main className="mx-auto max-w-2xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">{league.name}</h1>
      <Table className="text-left">
        <thead>
          <tr>
            <th className="px-2 py-1">Team</th>
            <th className="px-2 py-1">Manager</th>
          </tr>
        </thead>
        <tbody>
          {league.teams.map((team) => (
            <tr key={team.id} className="odd:bg-neutral-50">
              <td className="px-2 py-1">{team.name}</td>
              <td className="px-2 py-1">{team.manager}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </main>
  );
}
