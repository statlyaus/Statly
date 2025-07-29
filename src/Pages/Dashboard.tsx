import { FaTrophy, FaChartLine, FaUsers } from "react-icons/fa";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const teamRecord = "5 Wins – 4 Losses – 1 Draw";
  const yourTeamName = "Your Team";

  const recentActivity = [
    { icon: "🟢", message: "Nick Daicos led kicks and clearances in Round 18" },
    { icon: "🟡", message: "Player X was traded to your team" },
    { icon: "🔴", message: "Player Y was ruled out due to injury" }
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-8">
      <h2 className="text-3xl font-bold mb-6">Your Dashboard</h2>

      {/* Grid Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link
          to="/matchup"
          className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md hover:shadow-xl transition group"
        >
          <div className="flex items-center gap-4 mb-2">
            <FaTrophy className="text-yellow-400 text-xl group-hover:scale-110 transition" />
            <h3 className="text-xl font-semibold">Upcoming Matchup</h3>
          </div>
          <p className="text-sm text-gray-400">Round 19: vs Bambang’s Best Team</p>
        </Link>

        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md hover:shadow-xl transition">
          <div className="flex items-center gap-4 mb-2">
            <FaChartLine className="text-blue-400 text-xl" />
            <h3 className="text-xl font-semibold">Team Record</h3>
          </div>
          <p className="text-sm text-gray-400">{teamRecord}</p>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md hover:shadow-xl transition">
          <div className="flex items-center gap-4 mb-2">
            <FaUsers className="text-green-400 text-xl" />
            <h3 className="text-xl font-semibold">Top Scorer</h3>
          </div>
          <p className="text-sm text-gray-400">Nick Daicos – 122pts (Collingwood)</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="mt-12">
        <h3 className="text-2xl font-semibold mb-4">Performance Trends</h3>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md">
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm italic">
            [ Line chart placeholder ]
          </div>
        </div>
      </div>

      {/* Top Players Section */}
      <div className="mt-12">
        <h3 className="text-2xl font-semibold mb-4">Top 5 Players This Week</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-300 border border-gray-700 rounded">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-4 py-2">Player</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Stat Impact</th>
                <th className="px-4 py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-gray-800">
                <td className="px-4 py-2">Nick Daicos</td>
                <td className="px-4 py-2">Collingwood</td>
                <td className="px-4 py-2">122</td>
                <td className="px-4 py-2">$1.2M</td>
              </tr>
              <tr className="hover:bg-gray-800">
                <td className="px-4 py-2">Player X</td>
                <td className="px-4 py-2">Brisbane</td>
                <td className="px-4 py-2">119</td>
                <td className="px-4 py-2">$1.1M</td>
              </tr>
              <tr className="hover:bg-gray-800">
                <td className="px-4 py-2">Player Y</td>
                <td className="px-4 py-2">Carlton</td>
                <td className="px-4 py-2">115</td>
                <td className="px-4 py-2">$1.0M</td>
              </tr>
              <tr className="hover:bg-gray-800">
                <td className="px-4 py-2">Player Z</td>
                <td className="px-4 py-2">Sydney</td>
                <td className="px-4 py-2">113</td>
                <td className="px-4 py-2">$1.0M</td>
              </tr>
              <tr className="hover:bg-gray-800">
                <td className="px-4 py-2">Player A</td>
                <td className="px-4 py-2">Geelong</td>
                <td className="px-4 py-2">110</td>
                <td className="px-4 py-2">$980k</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Player Activity */}
      <div className="mt-12">
        <h3 className="text-2xl font-semibold mb-4">Recent Player Activity</h3>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md">
          <ul className="space-y-2 text-sm text-gray-300">
            {recentActivity.map((item, index) => (
              <li key={index}>
                {item.icon} {item.message}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* League Leaderboard */}
      <div className="mt-12">
        <h3 className="text-2xl font-semibold mb-4">League Leaderboard</h3>
        {/* Matchups are decided by wins in stat categories, not total fantasy points. */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 shadow-md">
          <table className="w-full text-sm text-gray-300">
            <thead>
              <tr className="text-left border-b border-gray-700">
                <th className="pb-2">Rank</th>
                <th className="pb-2">Team</th>
                <th className="pb-2">Record</th>
                <th className="pb-2">Total Stat Impact</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1">1</td>
                <td className="py-1">{yourTeamName}</td>
                <td className="py-1">6–3–1</td>
                <td className="py-1">1,248</td>
              </tr>
              <tr>
                <td className="py-1">2</td>
                <td className="py-1">Bambang's Best Team</td>
                <td className="py-1">6–4–0</td>
                <td className="py-1">1,206</td>
              </tr>
              <tr>
                <td className="py-1">3</td>
                <td className="py-1">Connor's Crushers</td>
                <td className="py-1">5–5–0</td>
                <td className="py-1">1,134</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}