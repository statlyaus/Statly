import { notFound } from 'next/navigation';
import { motion } from 'framer-motion';
import Table from '@/components/Table';
import { fetchFromAPI } from '@/lib/api';
import type { League, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';

interface LeagueResponse {
  league: League;
  members: LeagueMember[];
  memberCount: number;
  spotsRemaining: number;
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let leagueData: LeagueResponse | null = null;
  
  try {
    const response = await fetchFromAPI<{ data: LeagueResponse }>(`/api/leagues/${id}`);
    leagueData = response.data;
  } catch {
    // ignore
  }
  
  if (!leagueData) notFound();

  const { league, members, memberCount, spotsRemaining } = leagueData;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{league.name}</h1>
              {league.description && (
                <p className="text-gray-600 mb-4">{league.description}</p>
              )}
            </div>
            <div className="text-right">
              <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium mb-2">
                {league.code}
              </div>
              <div className="text-sm text-gray-500">
                {league.type === 'private' ? 'Private League' : 'Public League'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{memberCount}</div>
              <div className="text-sm text-gray-600">Teams</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{league.maxTeams}</div>
              <div className="text-sm text-gray-600">Max Teams</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{spotsRemaining}</div>
              <div className="text-sm text-gray-600">Spots Left</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{league.status}</div>
              <div className="text-sm text-gray-600">Status</div>
            </div>
          </div>
        </div>

        {/* Scoring Categories */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Scoring Categories</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {league.categories.map((category) => {
              const categoryData = FANTASY_CATEGORIES[category];
              return (
                <div key={category} className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium text-blue-900">{categoryData?.label || category}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* League Members */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">League Members</h2>
            {spotsRemaining > 0 && (
              <span className="text-sm text-green-600 font-medium">
                {spotsRemaining} spot{spotsRemaining !== 1 ? 's' : ''} available
              </span>
            )}
          </div>

          {members.length > 0 ? (
            <Table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-900">Team Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-900">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-900">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, index) => (
                  <motion.tr
                    key={member.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">{member.teamName}</span>
                        {member.role === 'owner' && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">
                            Owner
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{member.role}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No members yet. Be the first to join!</p>
            </div>
          )}
        </div>

        {/* League Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Trade Settings */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Trade Settings</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Trade Limit:</span>
                <span className="font-medium">{league.tradeSettings.tradeLimit} per team</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Review Process:</span>
                <span className="font-medium capitalize">{league.tradeSettings.tradeReview}</span>
              </div>
              {league.tradeSettings.tradeDeadline && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Trade Deadline:</span>
                  <span className="font-medium">
                    {new Date(league.tradeSettings.tradeDeadline).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Waiver Settings */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Waiver Wire</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Processing Period:</span>
                <span className="font-medium">{league.waiverWire.waiverPeriodHours} hours</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Reset Policy:</span>
                <span className="font-medium capitalize">{league.waiverWire.waiverResetPolicy}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Draft Info */}
        {league.draftDate && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Draft Information</h3>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Scheduled Date:</span>
              <span className="font-medium">
                {new Date(league.draftDate).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </main>
  );
}
