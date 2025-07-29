// pages/index.tsx

'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="sticky top-0 z-50 bg-blue-900 shadow-md p-4 flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white font-espn">Statly AFL</h1>
        <nav className="space-x-6 text-sm font-semibold text-white">
          <Link href="/">Home</Link>
          <Link href="/myteam">My Team</Link>
          <Link href="/stats">Player Stats</Link>
          <Link href="/rosters">Rosters</Link>
          <Link href="/tradecentre">Trade Centre</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/members">Members</Link>
        </nav>
      </div>

      {/* ⚠️ You must convert AuthForm to a Next.js-compatible component if needed */}

      {/* You can now add the rest of your layout */}
      <div className="bg-white p-6 rounded-lg shadow-md text-gray-800">
        <h2 className="text-xl font-semibold">Welcome to Statly!</h2>
        <p className="mt-2">This is your fantasy AFL dashboard.</p>
      </div>
    </div>
  );
}