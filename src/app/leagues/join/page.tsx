'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import type { JoinedLeagueSummary } from '@/types/leagues';
import Button from '@/components/Button';
import { LoadingSpinner } from '@/components/ui';
import Link from 'next/link';
import { AppLayout } from '@/components/navigation';

export default function JoinLeaguePage() {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [joinedLeague, setJoinedLeague] = useState<JoinedLeagueSummary | null>(
    null
  );
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill from URL parameters if provided
  useEffect(() => {
    const urlCode = searchParams?.get('code');
    const urlTeam = searchParams?.get('team');
    const decodedCode = urlCode ? decodeURIComponent(urlCode).trim() : '';
    const decodedTeam = urlTeam ? decodeURIComponent(urlTeam).trim() : '';
    if (decodedCode) {
      setCode(decodedCode.toUpperCase());
    }
    if (decodedTeam) {
      setTeamName(decodedTeam);
    }
  }, [searchParams]);

  const handleJoinLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setError('You must be logged in to join a league');
      return;
    }

    if (!code.trim()) {
      setError('Please enter a league code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await fetchApi('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          teamName: teamName.trim() || undefined
        }),
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (
        result?.success &&
        result?.data?.league?.id &&
        result?.data?.league?.name
      ) {
        setJoinedLeague(result.data.league);
      } else {
        throw new Error(result?.error || 'Unexpected response');
      }

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <h1 className="text-2xl font-bold text-center mb-6">Join League</h1>
          <p className="text-gray-600 text-center mb-4">
            Please log in to join a league
          </p>
          <Link href="/auth/login" className="block">
            <Button className="w-full">Log In</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const handleAddToCalendar = () => {
    if (!joinedLeague?.draftDate) return;
    const esc = (s: string) =>
      s.replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
    const format = (date: string) =>
      date.replace(/[-:]/g, '').split('.')[0] + 'Z';
    const start = format(joinedLeague.draftDate);
    const dtstamp = format(new Date().toISOString());
    const summary = `${esc(joinedLeague.name)} Draft`;
    const description = `Draft for ${esc(joinedLeague.name)}`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Statly//EN',
      'BEGIN:VEVENT',
      `UID:${joinedLeague.id}-draft@statly`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const ics = lines.join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${joinedLeague.name.replace(/\s+/g, '_')}_draft.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (joinedLeague) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Successfully Joined {joinedLeague.name}!
            </h2>
            <div className="flex flex-col gap-3 mt-4">
              {joinedLeague.draftDate && (
                <Button onClick={handleAddToCalendar}>
                  Add Draft to Calendar
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => router.push(`/leagues/${joinedLeague.id}`)}
              >
                Go to League
              </Button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-center mb-6">Join League</h1>
      
      <form onSubmit={handleJoinLeague} className="space-y-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
            League Code *
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter 6-character code"
            maxLength={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono tracking-wider text-center text-lg"
            disabled={loading}
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Ask the league admin for the join code
          </p>
        </div>

        <div>
          <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 mb-1">
            Team Name (Optional)
          </label>
          <input
            id="teamName"
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="My Awesome Team"
            maxLength={30}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave blank for auto-generated name
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full"
        >
          {loading ? (
            <>
              <LoadingSpinner />
              Joining League...
            </>
          ) : (
            'Join League'
          )}
        </Button>
      </form>

      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-600 text-center">
          Don&apos;t have a league code?{' '}
          <Link href="/leagues/new" className="text-blue-600 hover:text-blue-700 font-medium">
            Create your own league
          </Link>
        </p>
      </div>
      </div>
    </AppLayout>
  );
}
