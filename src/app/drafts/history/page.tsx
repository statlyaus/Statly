export const revalidate = 3600;
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function DraftHistoryPage() {
  // Fetch all drafts
  const drafts = await prisma.draft.findMany({
    include: {
      league: {
        include: {
          settings: true,
          members: {
            include: {
              user: true,
            },
          },
        },
      },
      picks: {
        take: 1, // Just get the count
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Draft History</h1>
      
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">All Drafts</h2>
          <p className="text-sm text-gray-600">
            View and manage all your fantasy drafts
          </p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Draft Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teams
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {draft.league?.name || 'Unnamed Draft'}
                    </div>
                    <div className="text-sm text-gray-500">
                      ID: {draft.id.slice(0, 8)}...
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      draft.status === 'LIVE' 
                        ? 'bg-green-100 text-green-800'
                        : draft.status === 'COMPLETED'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {draft.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {draft.league?.members?.length || 0} teams
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    Pick {draft.currentPick} / {(draft.league?.members?.length || 0) * ((draft.league?.settings?.rosterSize || 0) + (draft.league?.settings?.benchSize || 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                    <Link
                      href={`/drafts/${draft.id}`}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {draft.status === 'LIVE' ? 'Join Draft' : 'View Draft'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="mt-8">
        <Link
          href="/drafts"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          ← Back to Drafts
        </Link>
      </div>
    </div>
  );
}
