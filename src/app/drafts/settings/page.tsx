import { AppLayout } from '@/components/navigation';
import Link from 'next/link';

export default function DraftSettingsPage() {
  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/drafts"
              className="text-blue-600 hover:text-blue-800 flex items-center gap-2"
            >
              ← Back to Drafts
            </Link>
          </div>
          <h1 className="text-3xl font-bold">Draft Settings</h1>
          <p className="text-gray-600 mt-2">
            Configure your draft preferences and default settings.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Default Draft Settings */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Default Draft Settings</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Default Time Per Pick
                </label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value={60}>1 minute</option>
                  <option value={90}>1.5 minutes</option>
                  <option value={120} selected>2 minutes</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Default Draft Type
                </label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="snake" selected>Snake Draft</option>
                  <option value="linear">Linear Draft</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Default League Size
                </label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value={8}>8 teams</option>
                  <option value={10}>10 teams</option>
                  <option value={12} selected>12 teams</option>
                  <option value={14}>14 teams</option>
                  <option value={16}>16 teams</option>
                </select>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enableReminders"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  defaultChecked
                />
                <label htmlFor="enableReminders" className="ml-2 text-sm text-gray-700">
                  Enable draft reminders by default
                </label>
              </div>
            </div>

            <button className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
              Save Default Settings
            </button>
          </div>

          {/* Notification Preferences */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Notification Preferences</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Email Notifications</h3>
                  <p className="text-sm text-gray-600">Receive draft reminders via email</p>
                </div>
                <input
                  type="checkbox"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  defaultChecked
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Push Notifications</h3>
                  <p className="text-sm text-gray-600">Browser notifications for draft events</p>
                </div>
                <input
                  type="checkbox"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  defaultChecked
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Draft Start Alerts</h3>
                  <p className="text-sm text-gray-600">Alert when it's your turn to pick</p>
                </div>
                <input
                  type="checkbox"
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  defaultChecked
                />
              </div>
            </div>

            <button className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
              Save Notification Settings
            </button>
          </div>

          {/* Draft History */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Draft History</h2>
            <p className="text-gray-600 mb-4">
              Manage your draft history and export data.
            </p>
            
            <div className="space-y-3">
              <button className="w-full bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-colors">
                View All Draft History
              </button>
              <button className="w-full bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-colors">
                Export Draft Data
              </button>
              <button className="w-full bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors">
                Clear Draft History
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
            
            <div className="space-y-3">
              <Link
                href="/drafts/create"
                className="block w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors text-center"
              >
                Create New Draft
              </Link>
              <Link
                href="/test-draft"
                className="block w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-center"
              >
                Create Test Draft
              </Link>
              <Link
                href="/players"
                className="block w-full bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-colors text-center"
              >
                View Player Pool
              </Link>
            </div>
          </div>
        </div>

        {/* Debug Section */}
        <section className="mt-8 p-6 bg-yellow-50 rounded-lg border border-yellow-200">
          <h2 className="text-lg font-semibold text-yellow-900 mb-4">Debug & Testing</h2>
          <p className="text-yellow-800 mb-4">
            Tools for testing and debugging the draft system.
          </p>
          
          <div className="flex gap-4 flex-wrap">
            <a
              href="/api/drafts/list"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 transition-colors"
            >
              View All Drafts (API)
            </a>
            <a
              href="/api/test-lobby"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 transition-colors"
            >
              Test Lobby System
            </a>
            <Link
              href="/test-draft"
              className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 transition-colors"
            >
              Test Draft Creator
            </Link>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}
