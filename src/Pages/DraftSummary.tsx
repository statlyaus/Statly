import React, { useEffect, useState } from 'react';
import type { Player } from '../types';
import { useAuth } from '../AuthContext';
import { loadUserSettings, saveUserSettings } from '../firebaseHelpers';

interface DraftSummaryProps {
  draftedPlayers: Record<string, Player[]>;
}

const DraftSummary: React.FC<DraftSummaryProps> = ({ draftedPlayers }) => {
  const { user } = useAuth();
  const [draftHistory, setDraftHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    loadUserSettings(user.uid).then((settings) => {
      setDraftHistory(settings.draftHistory || []);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    saveUserSettings(user.uid, { draftHistory });
  }, [user?.uid, draftHistory]);

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-md max-w-3xl mx-auto mt-10">
      <h2 className="text-2xl font-bold mb-6 text-center">Draft Summary</h2>
      {Object.entries(draftedPlayers).map(([teamId, players]) => (
        <div key={teamId} className="mb-6">
          <h3 className="text-xl font-semibold mb-2">Team {teamId}</h3>
          <ul className="list-disc ml-6">
            {players.map((player, index) => (
              <li key={index}>
                {capitalizeWords(player.name)} –{' '}
                {player.team
                  ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase()
                  : ''}{' '}
                –{' '}
                {player.position
                  ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase()
                  : ''}{' '}
                – Avg: {player.avg ?? 'N/A'} pts
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-2">Your Draft History</h3>
        {draftHistory.length === 0 ? (
          <p className="text-gray-500 text-sm">No draft history yet.</p>
        ) : (
          <ul className="list-disc ml-6">
            {draftHistory.map((entry, idx) => (
              <li key={idx}>
                {entry.date}: {entry.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DraftSummary;
