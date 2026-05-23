import Link from 'next/link';
import { AppLayout } from '@/components/navigation';

export default function DraftsPage() {
  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Draft Center</h1>
          <p className="text-gray-600 mt-2">
            Manage your fantasy AFL drafts and participate in live draft sessions.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Active Drafts */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Active Drafts</h2>
            <p className="text-gray-600 mb-4">No active drafts at the moment.</p>
            <Link
              href="/drafts/create"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create New Draft
            </Link>
          </div>

          {/* Recent Drafts */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Drafts</h2>
            <p className="text-gray-600 mb-4">View your recently completed drafts.</p>
            <Link
              href="/drafts/history"
              className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              View History
            </Link>
          </div>

          {/* Draft Settings */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Draft Settings</h2>
            <p className="text-gray-600 mb-4">Configure your draft preferences and settings.</p>
            <Link
              href="/drafts/settings"
              className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Manage Settings
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <section className="mt-8">
          <h2 className="text-2xl font-semibold mb-4">Quick Actions</h2>
          <div className="flex gap-4 flex-wrap">
            <Link
              href="/players"
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              View Player Pool
            </Link>
            <Link
              href="/rankings"
              className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
            >
              Player Rankings
            </Link>
            <Link
              href="/stats"
              className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors"
            >
              Season Stats
            </Link>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}
