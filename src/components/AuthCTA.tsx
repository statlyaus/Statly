import Link from "next/link";

export default function AuthCTA() {
  return (
    <main className="p-6 text-center space-y-4" role="main">
      <h1 className="text-2xl font-bold text-gray-900">You&apos;re not signed in</h1>
      <p className="text-gray-600">Please sign in to view your dashboard.</p>
      <div>
        <Link
          href="/"
          className="inline-flex items-center rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Sign In
        </Link>
      </div>
    </main>
  );
}