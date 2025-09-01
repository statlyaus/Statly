/**
 * Example integration of LeagueChat component
 * This shows how the fixed component could be used in the LeagueTabs
 */

import React from 'react';
import LeagueChat from './LeagueChat';

// Example of how to integrate LeagueChat in LeagueTabs
export function LeagueChatTab({
  leagueId,
  currentUserId,
}: {
  leagueId: string;
  currentUserId?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">League Discussion</h3>
          <p className="mt-1 text-sm text-gray-600">Chat with your league members in real-time</p>
        </div>

        <div className="p-6">
          <LeagueChat leagueId={leagueId} currentUserId={currentUserId} />
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Chat Guidelines</h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc pl-5 space-y-1">
                <li>Keep conversations respectful and fun</li>
                <li>No spam or excessive messaging</li>
                <li>Trade discussions should also use the Trade Center</li>
                <li>Chat history is limited to 200 recent messages</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Example usage in LeagueTabs.tsx:
/*
// Add 'chat' to the TabType union
type TabType = 'overview' | 'teams' | 'roster' | 'trades' | 'waivers' | 'draft' | 'chat' | 'settings';

// Add to the tabs array
const tabs: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'teams', name: 'Teams' },
  { id: 'roster', name: 'My Team' },
  { id: 'trades', name: 'Trades' },
  { id: 'waivers', name: 'Waivers' },
  { id: 'draft', name: 'Draft' },
  { id: 'chat', name: 'Chat' }, // <-- Add this
  { id: 'settings', name: 'Settings' },
];

// Add to the switch statement in tab content rendering
case 'chat':
  return <LeagueChatTab leagueId={league.id} currentUserId={currentUserId} />;
*/
