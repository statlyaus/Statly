'use client';

import { useTeamContext } from '@/contexts/TeamContext';

export default function TeamSwitcher() {
  const { teams, activeLeague, activeMember, switchTeam, loading } = useTeamContext();

  if (!teams || teams.length === 0) return null;

  return (
    <div className="relative inline-block text-left">
      <div className="group">
        <button className="px-3 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200">
          {activeLeague ? `League ${activeLeague.slice(0, 6)}…` : 'Select Team'}
        </button>
        <div className="hidden group-hover:block absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          <div className="max-h-72 overflow-y-auto py-2">
            {teams.map((t) => (
              <button
                key={`${t.leagueId}:${t.memberId}`}
                disabled={loading}
                onClick={() => switchTeam(t.leagueId, t.memberId)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                  activeLeague === t.leagueId && activeMember === t.memberId ? 'bg-blue-50 text-blue-700' : ''
                }`}
              >
                <div className="font-medium">{t.teamName || t.memberId.slice(0, 8)}</div>
                <div className="text-xs text-gray-500">League {t.leagueId.slice(0, 8)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

