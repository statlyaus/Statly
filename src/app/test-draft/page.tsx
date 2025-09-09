'use client';

import { useState } from 'react';

import Button from '@/components/Button';
import { Alert } from '@/components/ui';

interface Draft {
  id: string;
  status: string;
  lobbyStatus: string;
  leagueName: string;
  lobbyOpenAt: string;
  draftStartTime: string;
  url: string;
}

export default function TestDraftPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const createTestDraft = async () => {
    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/create-test-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Test draft created successfully!');
        setDrafts((prev) => [data.data.draft, ...prev]);
      } else {
        setError(data.error || 'Failed to create test draft');
      }
    } catch (err) {
      setError('Failed to create test draft');
    } finally {
      setIsCreating(false);
    }
  };

  const loadExistingDrafts = async () => {
    try {
      const response = await fetch('/api/drafts/list');
      const data = await response.json();

      if (response.ok) {
        setDrafts(
          data.data.drafts.map((draft: any) => ({
            id: draft.id,
            status: draft.status,
            lobbyStatus: 'unknown',
            leagueName: draft.leagueName,
            lobbyOpenAt: draft.startAt,
            draftStartTime: draft.startAt,
            url: `/drafts/${draft.id}`,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load drafts:', err);
      setError('Failed to load drafts');
    }
  };

  const formatTime = (timeString: string) => {
    try {
      return new Date(timeString).toLocaleString();
    } catch {
      return timeString;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Test Draft Creator</h1>

          <div className="mb-6">
            <p className="text-gray-600 mb-4">
              Create test drafts to test the lobby and draft functionality. Each test draft will be
              scheduled to start in 6 minutes with the lobby opening in 1 minute.
            </p>

            {error && (
              <Alert type="error" className="mb-4">
                {error}
              </Alert>
            )}

            {success && (
              <Alert type="success" className="mb-4">
                {success}
              </Alert>
            )}

            <div className="flex gap-4">
              <Button
                onClick={createTestDraft}
                disabled={isCreating}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create Test Draft'}
              </Button>

              <Button
                onClick={loadExistingDrafts}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
              >
                Load Existing Drafts
              </Button>
            </div>
          </div>

          {drafts.length > 0 && (
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Available Drafts</h2>

              <div className="space-y-4">
                {drafts.map((draft) => (
                  <div key={draft.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">{draft.leagueName}</h3>
                        <p className="text-sm text-gray-500">ID: {draft.id}</p>
                        <p className="text-sm text-gray-500">
                          Status: {draft.status} | Lobby: {draft.lobbyStatus}
                        </p>
                        {draft.draftStartTime && (
                          <p className="text-sm text-gray-500">
                            Starts: {formatTime(draft.draftStartTime)}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <a
                          href={draft.url}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                        >
                          Enter Draft
                        </a>
                        <a
                          href={`/api/drafts/${draft.id}/debug`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
                        >
                          Debug
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <ol className="list-decimal pl-5 space-y-1 text-blue-900">
              <li>Click "Create Test Draft" to create a new draft</li>
              <li>Click "Enter Draft" to access the draft page</li>
              <li>The lobby will open 1 minute after creation</li>
              <li>The draft will start 6 minutes after creation</li>
              <li>Test the queue and watchlist functionality in the lobby</li>
            </ol>
          </div>

          <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
            <h3 className="font-medium text-yellow-900 mb-2">Useful Endpoints:</h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>
                •{' '}
                <a href="/api/drafts/list" target="_blank" className="underline">
                  List all drafts
                </a>
              </li>
              <li>
                •{' '}
                <a href="/api/test-lobby" target="_blank" className="underline">
                  Test lobby setup
                </a>
              </li>
              <li>• Debug specific draft: /api/drafts/[id]/debug</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
