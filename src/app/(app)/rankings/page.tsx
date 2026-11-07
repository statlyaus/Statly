import { unstable_cache } from 'next/cache';

import NineCategoryRankingsTable from '@/components/rankings/NineCategoryRankingsTable';
import { getCategoryRankings } from '@/server/rankings/getCategoryRankings';

// Same five-minute freshness the rankings API advertises to the CDN.
const getDefaultRankings = unstable_cache(
  () => getCategoryRankings({ season: 2025 }),
  ['rankings:default:2025'],
  { revalidate: 300 }
);

export default async function RankingsPage() {
  const { players } = await getDefaultRankings();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">Player Rankings</h1>
        <p className="text-lg text-gray-600">
          Player rankings based on 9 AFL statistical categories
        </p>

        {/* Legend */}
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 mb-2">Stat Strength Legend:</h3>
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-green-50 text-green-700">
                🔥 Elite (Z ≥ 2.0)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-green-100 text-green-600">
                ⭐ Excellent (Z ≥ 1.0)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-600">
                📈 Above Avg (Z ≥ 0.5)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
                ➖ Average (Z ≥ -0.5)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-orange-100 text-orange-600">
                📉 Below Avg (Z ≥ -1.0)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-1 rounded bg-red-100 text-red-600">
                ❌ Poor (Z &lt; -1.0)
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Numbers show per-game averages. Icons and colors indicate strength relative to league
            average (Z-score).
          </p>
        </div>
      </header>

      {/* Rankings table */}
      <NineCategoryRankingsTable players={players} />
    </div>
  );
}
