import Link from 'next/link';

export default function Header() {
  return (
    <header className="bg-blue-900 sticky top-0 z-50 shadow-md p-4 flex justify-between items-center">
      <h1 className="text-2xl font-bold text-white">Statly AFL</h1>
      <nav className="space-x-4">
        <Link href="/" className="text-white hover:text-gray-300">
          Home
        </Link>
        <Link href="/myteam" className="text-white hover:text-gray-300">
          My Team
        </Link>
        <Link href="/stats" className="text-white hover:text-gray-300">
          Player Stats
        </Link>
        {/* Add more links as needed */}
      </nav>
    </header>
  );
}