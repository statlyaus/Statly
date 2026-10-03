'use client';

import { useRouter } from 'next/navigation';

import type { MemberLeagueOption } from '@/server/leagues/memberLeagueOptions';

export function LeagueToolSwitcher({
  path,
  leagues,
  selectedLeagueId,
}: {
  path: string;
  leagues: MemberLeagueOption[];
  selectedLeagueId: string;
}) {
  const router = useRouter();

  return (
    <label className="block text-sm font-semibold text-foreground">
      League
      <select
        value={selectedLeagueId}
        onChange={(event) =>
          router.push(`${path}?league=${encodeURIComponent(event.target.value)}`)
        }
        className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
      >
        {leagues.map((league) => (
          <option key={league.id} value={league.id}>
            {league.name}
          </option>
        ))}
      </select>
    </label>
  );
}
