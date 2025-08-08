import Link from "next/link";

export default function Page() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
      <p className="mb-6">Welcome to your dashboard!</p>

      <div className="space-y-4">
        <Link
          href="/players"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          View Players
        </Link>
      </div>
    </main>
  );
}