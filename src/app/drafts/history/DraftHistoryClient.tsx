'use client';

import { useState, useEffect } from 'react';

import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import { TeamLogo } from '@/components/TeamLogo';
import { fetchApi } from '@/lib/api';

interface DraftHistory {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  totalPicks: number;
  participants: Array<{
    id: string;
    displayName: string;
    teamName: string;
    picks: Array<{
      player: { name: string; position: string; club: string };
      overall: number;
      round: number;
    }>;
  }>;
}

export default function DraftHistoryClient() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDraftHistory = async () => {
      if (!user) return;
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetchApi('drafts/history');
        if (response.success) setDrafts(response.data || []);
        else setError(response.error || 'Failed to load draft history');
      } catch (err) {
        console.error('Error fetching draft history:', err);
        setError('Failed to load draft history');
      } finally {
        setIsLoading(false);
      }
    };
    void fetchDraftHistory();
  }, [user]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      COMPLETED: 'bg-success/10 text-success',
      PAUSED: 'bg-warning/10 text-warning',
      CANCELLED: 'bg-destructive/10 text-destructive',
    };
    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status] || 'bg-muted text-foreground'}`}
      >
        {status}
      </span>
    );
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4">Sign in Required</h1>
            <p className="text-muted-foreground">Please sign in to view your draft history.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Draft History</h1>
          <p className="text-muted-foreground mt-2">
            Review your completed drafts and analyze your team selections.
          </p>
        </header>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-info/20"></div>
            <span className="ml-3 text-muted-foreground">Loading draft history...</span>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center space-x-2">
              <svg
                className="h-5 w-5 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <span className="text-destructive">{error}</span>
            </div>
          </div>
        )}
        {!isLoading && !error && drafts.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-foreground">No drafts yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">Complete your first draft to see it here.</p>
          </div>
        )}
        {!isLoading && !error && drafts.length > 0 && (
          <div className="space-y-6">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="bg-white rounded-lg shadow-sm border border-border overflow-hidden"
              >
                <div className="px-6 py-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{draft.name}</h3>
                      <div className="flex items-center space-x-4 mt-1 text-sm text-muted-foreground">
                        <span>Created: {formatDate(draft.createdAt)}</span>
                        {draft.completedAt && (
                          <span>Completed: {formatDate(draft.completedAt)}</span>
                        )}
                        <span>{draft.totalPicks} picks</span>
                      </div>
                    </div>
                    {getStatusBadge(draft.status)}
                  </div>
                </div>
                <div className="px-6 py-4">
                  <h4 className="text-sm font-medium text-foreground mb-3">Team Rosters</h4>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {draft.participants.map((participant) => (
                      <div key={participant.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="font-medium text-foreground">{participant.teamName}</h5>
                          <span className="text-xs text-muted-foreground">
                            {participant.picks.length} players
                          </span>
                        </div>
                        <div className="space-y-1">
                          {participant.picks
                            .sort((a, b) => a.overall - b.overall)
                            .map((pick) => (
                              <div
                                key={`${participant.id}-${pick.overall}`}
                                className="flex items-center justify-between text-sm"
                              >
                                <div>
                                  <span className="font-medium">{pick.player.name}</span>
                                  <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
                                    <span aria-hidden> • </span>
                                    <span>{pick.player.position}</span>
                                    <span aria-hidden> • </span>
                                    <TeamLogo
                                      team={pick.player.club}
                                      size={14}
                                      withCircle
                                      decorative
                                    />
                                    <span>{pick.player.club}</span>
                                  </span>
                                </div>
                                <span className="text-muted-foreground">#{pick.overall}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </AppLayout>
  );
}
