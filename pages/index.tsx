// pages/index.tsx

'use client';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="sticky top-0 z-50 bg-blue-900 shadow-lg p-6 flex justify-between items-center mb-8 rounded-lg">
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Statly</h1>
        <nav className="space-x-8 text-base font-medium text-blue-100">
          <a href="/" className="hover:text-white transition-colors">Home</a>
          <a href="/myteam" className="hover:text-white transition-colors">My Team</a>
          <a href="/stats" className="hover:text-white transition-colors">Player Stats</a>
          <a href="/rosters" className="hover:text-white transition-colors">Rosters</a>
          <a href="/tradecentre" className="hover:text-white transition-colors">Trade Centre</a>
          <a href="/leaderboard" className="hover:text-white transition-colors">Leaderboard</a>
          <a href="/settings" className="hover:text-white transition-colors">Settings</a>
          <a href="/members" className="hover:text-white transition-colors">Members</a>
        </nav>
      </div>

      {/* ⚠️ You must convert AuthForm to a Next.js-compatible component if needed */}

      {/* You can now add the rest of your layout */}
      <div className="bg-white p-6 rounded-lg shadow-md text-gray-800 ">
        <h2 className="text-2xl font-semibold mb-4">Welcome to Statly!</h2>
        <p className="mt-2">This is your fantasy AFL dashboard.</p>
      </div>
    </div>
  );
}
