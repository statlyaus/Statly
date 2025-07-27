import React from "react";
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="sticky top-0 z-50 bg-blue-900 shadow-md p-4 flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white font-espn">Statly AFL</h1>
        <nav className="space-x-6 text-sm font-semibold text-white">
          <Link to="/" className="hover:underline">Home</Link>
          <Link to="/myteam" className="hover:underline">My Team</Link>
          <Link to="/stats" className="hover:underline">Player Stats</Link>
          <Link to="/rosters" className="hover:underline">Rosters</Link>
          <Link to="/tradecentre" className="hover:underline">Trade Centre</Link>
          <Link to="/leaderboard" className="hover:underline">Leaderboard</Link>
          <Link to="/settings" className="hover:underline">Settings</Link>
          <Link to="/members" className="hover:underline">Members</Link>
        </nav>
      </div>

      {/* ESPN-style League Overview Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Boston Pro H2H Most Categories League</h2>
        <div className="flex flex-wrap justify-between text-sm text-gray-600 border-b border-gray-200 pb-3">
          <span>Format: Standard</span>
          <span>Scoring: Head to Head Most Categories</span>
          <span>Teams: 10</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">📋 My Team</h2>
          <p className="mb-4 text-gray-600">Track your lineup’s performance with live updates.</p>
          <Link to="/myteam" className="text-blue-600 hover:underline font-medium">Go to My Team →</Link>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">🔁 Trade Centre</h2>
          <p className="mb-4 text-gray-600">Optimise trades and plan your next move easily.</p>
          <Link to="/tradecentre" className="text-blue-600 hover:underline font-medium">Access Trade Centre →</Link>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">📊 Player Stats</h2>
          <p className="mb-4 text-gray-600">Browse performance metrics across the league.</p>
          <Link to="/stats" className="text-blue-600 hover:underline font-medium">View Player Stats →</Link>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">🏆 Leaderboard</h2>
          <p className="mb-4 text-gray-600">See how your team ranks week by week.</p>
          <Link to="/leaderboard" className="text-blue-600 hover:underline font-medium">Check the Leaderboard →</Link>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">📝 Draft Board</h2>
          <p className="mb-4 text-gray-600">Manage your live draft picks and see available players.</p>
          <Link to="/draft" className="text-blue-600 hover:underline font-medium">Enter Draft Board →</Link>
        </div>
      </div>

      {/* Weekly Matchup */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">This Week's Matchup</h3>
        <div className="flex justify-between items-center text-sm text-gray-800 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 text-blue-700 font-bold py-1 px-3 rounded-full">Your Team</div>
            <span className="text-gray-600">vs</span>
            <div className="bg-red-100 text-red-700 font-bold py-1 px-3 rounded-full">Bambang's Best Team</div>
          </div>
          <div className="text-gray-500 text-xs">Round 18</div>
        </div>
        <table className="w-full text-sm text-gray-700 border-t border-b border-gray-200">
          <thead>
            <tr>
              <th className="text-left py-2">Category</th>
              <th className="text-center py-2">You</th>
              <th className="text-center py-2">Bambang</th>
              <th className="text-right py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Kicks', 128, 110, 'Win'],
              ['Handballs', 92, 100, 'Loss'],
              ['Marks', 65, 54, 'Win'],
              ['Tackles', 48, 48, 'Draw'],
              ['Goals', 15, 18, 'Loss'],
              ['Hitouts', 39, 33, 'Win'],
              ['Clearances', 31, 28, 'Win'],
              ['Inside 50s', 42, 37, 'Win'],
              ['Rebound 50s', 26, 29, 'Loss'],
              ['Contested Possessions', 58, 60, 'Loss']
            ].map(([category, you, opp, result]) => (
              <tr key={category} className="border-t border-gray-100">
                <td className="py-2">{category}</td>
                <td className="text-center py-2">{you}</td>
                <td className="text-center py-2">{opp}</td>
                <td className="text-right py-2 font-semibold text-gray-600">{result}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-sm text-gray-700 font-medium text-right">
          Weekly Record: <span className="text-blue-600">5 Wins – 4 Losses – 1 Draw</span>
        </div>
      </div>

      {/* Recent Activity & Player News Section */}
      <div className="grid md:grid-cols-1 gap-6 mb-6">
        {/* Recent Activity + Player News */}
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            {/* Recent Activity */}
            <div className="md:pr-6 md:border-r md:border-gray-300">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Activity</h3>
              <table className="w-full text-sm text-gray-700">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="py-2 text-left">Date</th>
                    <th className="py-2 text-left">Type</th>
                    <th className="py-2 text-left">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200">
                    <td className="py-2">Tue Jul 22</td>
                    <td className="py-2 text-green-600 font-semibold">Added</td>
                    <td className="py-2">
                      <Link to="/teams/ronnies-rowdy" className="text-blue-600 hover:underline">Ronnie's Rowdy Team</Link> added <Link to="/players/jayson-tatum" className="text-blue-600 hover:underline">Jayson Tatum</Link>
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-2">Tue Jul 22</td>
                    <td className="py-2 text-red-600 font-semibold">Dropped</td>
                    <td className="py-2">
                      <Link to="/teams/michaels" className="text-blue-600 hover:underline">Michael's Team</Link> dropped <Link to="/players/jusuf-nurkic" className="text-blue-600 hover:underline">Jusuf Nurkic</Link>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="text-right mt-3">
                <Link to="/activity" className="text-blue-600 hover:underline font-medium text-sm">See Full Recent Activity →</Link>
              </div>
            </div>

            {/* Player News */}
            <div className="md:pl-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Player News</h3>
              <ul className="space-y-3 text-sm text-gray-700">
                <li className="border-b pb-2">
                  <strong className="text-blue-600">Nick Daicos</strong> expected to return after minor calf tightness. Will undergo fitness test Friday.
                </li>
                <li className="border-b pb-2">
                  <strong className="text-blue-600">Marcus Bontempelli</strong> dominated in training and is likely to play more midfield minutes.
                </li>
                <li className="border-b pb-2">
                  <strong className="text-blue-600">Max Gawn</strong> managing workload after minor soreness, expected to play Round 19.
                </li>
              </ul>
              <div className="text-right mt-3">
                <Link to="/news" className="text-blue-600 hover:underline font-medium text-sm">More Player News →</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* League Standings */}
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">League Standings</h3>
        <table className="w-full text-sm text-gray-800 border border-gray-300 rounded">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2 border-b border-gray-300">RK</th>
              <th className="p-2 border-b border-gray-300">TEAM</th>
              <th className="p-2 border-b border-gray-300">W</th>
              <th className="p-2 border-b border-gray-300">L</th>
              <th className="p-2 border-b border-gray-300">T</th>
              <th className="p-2 border-b border-gray-300">PCT</th>
              <th className="p-2 border-b border-gray-300">GB</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-200">
              <td className="p-2 text-gray-600">1</td>
              <td className="p-2 text-blue-600 hover:underline truncate max-w-[160px]">Matthew's Monstrous Team</td>
              <td className="p-2">14</td>
              <td className="p-2">3</td>
              <td className="p-2">1</td>
              <td className="p-2">.806</td>
              <td className="p-2">--</td>
            </tr>
            <tr className="border-t border-gray-200">
              <td className="p-2 text-gray-600">2</td>
              <td className="p-2 text-blue-600 hover:underline truncate max-w-[160px]">Ronnie's Rowdy Team</td>
              <td className="p-2">13</td>
              <td className="p-2">5</td>
              <td className="p-2">0</td>
              <td className="p-2">.722</td>
              <td className="p-2">1.5</td>
            </tr>
            <tr className="border-t border-gray-200">
              <td className="p-2 text-gray-600">3</td>
              <td className="p-2 text-blue-600 hover:underline truncate max-w-[160px]">Bambang's Best Team</td>
              <td className="p-2">11</td>
              <td className="p-2">6</td>
              <td className="p-2">1</td>
              <td className="p-2">.639</td>
              <td className="p-2">3</td>
            </tr>
            <tr className="border-t border-gray-200">
              <td className="p-2 text-gray-600">4</td>
              <td className="p-2 text-blue-600 hover:underline truncate max-w-[160px]">Michael's Magnificent Team</td>
              <td className="p-2">10</td>
              <td className="p-2">8</td>
              <td className="p-2">0</td>
              <td className="p-2">.556</td>
              <td className="p-2">4.5</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Home;