'use client';

import React, { useMemo } from 'react';

import type { DraftState, DraftPick, DraftParticipant } from '@/types/draft';

interface DraftAnalyticsProps {
  draft: DraftState;
  picks: DraftPick[];
  participants: DraftParticipant[];
}

export default function DraftAnalytics({ draft, picks, participants }: DraftAnalyticsProps) {
  // Calculate analytics
  const analytics = useMemo(() => {
    const totalPicks = picks.length;
    const completedRounds = Math.floor(totalPicks / participants.length);
    const currentRound = Math.ceil(draft.currentPick / participants.length);

    // Average pick time (excluding auto-picks)
    const manualPicks = picks.filter((p) => !p.auto);
    const avgPickTime =
      manualPicks.length > 0
        ? manualPicks.reduce((sum, p) => sum + (p.timeToMake || 0), 0) / manualPicks.length
        : 0;

    // Auto-pick statistics
    const autoPickCount = picks.filter((p) => p.auto).length;
    const autoPickPercentage = totalPicks > 0 ? (autoPickCount / totalPicks) * 100 : 0;

    // Position distribution
    const positionCounts = picks.reduce(
      (acc, pick) => {
        const pos = pick.player.position;
        acc[pos] = (acc[pos] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Participant engagement
    const participantStats = participants.map((participant) => {
      const participantPicks = picks.filter((p) => p.member.userId === participant.userId);
      const avgTime =
        participantPicks.length > 0
          ? participantPicks.reduce((sum, p) => sum + (p.timeToMake || 0), 0) /
            participantPicks.length
          : 0;

      return {
        ...participant,
        picks: participantPicks.length,
        avgPickTime: avgTime,
        autoPicks: participantPicks.filter((p) => p.auto).length,
      };
    });

    // Draft progress by round
    const totalRounds = draft.settings?.totalRounds ?? 0;
    const roundProgress =
      totalRounds > 0
        ? Array.from({ length: totalRounds }, (_, i) => {
            const roundNumber = i + 1;
            const roundPicks = picks.filter((p) => p.round === roundNumber);
            const roundProgress = (roundPicks.length / participants.length) * 100;

            return {
              round: roundNumber,
              picks: roundPicks.length,
              progress: roundProgress,
              isComplete: roundProgress === 100,
              isCurrent: roundNumber === currentRound,
            };
          })
        : [];

    return {
      totalPicks,
      completedRounds,
      currentRound,
      avgPickTime,
      autoPickCount,
      autoPickPercentage,
      positionCounts,
      participantStats,
      roundProgress,
      draftProgress: (totalPicks / draft.totalPicks) * 100,
    };
  }, [draft, picks, participants]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-info/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-info"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Draft Progress</p>
              <p className="text-2xl font-semibold text-foreground">
                {analytics.draftProgress.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Completed Rounds</p>
              <p className="text-2xl font-semibold text-foreground">
                {analytics.completedRounds}/{draft.settings?.totalRounds ?? 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-warning/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-warning"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Avg Pick Time</p>
              <p className="text-2xl font-semibold text-foreground">
                {analytics.avgPickTime > 0 ? `${analytics.avgPickTime.toFixed(1)}s` : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Auto-Picks</p>
              <p className="text-2xl font-semibold text-foreground">
                {analytics.autoPickPercentage.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Round Progress */}
      <div className="bg-white rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Round Progress</h3>
        <div className="space-y-3">
          {analytics.roundProgress.map((round) => (
            <div key={round.round} className="flex items-center space-x-4">
              <div className="w-16 text-sm font-medium text-foreground">Round {round.round}</div>
              <div className="flex-1">
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      round.isComplete
                        ? 'bg-success'
                        : round.isCurrent
                          ? 'bg-info'
                          : 'bg-muted'
                    }`}
                    style={{ width: `${round.progress}%` }}
                  />
                </div>
              </div>
              <div className="w-20 text-sm text-muted-foreground text-right">
                {round.picks}/{participants.length}
              </div>
              <div className="w-16 text-sm text-right">
                {round.isComplete ? (
                  <span className="text-success">✓</span>
                ) : round.isCurrent ? (
                  <span className="text-info">●</span>
                ) : (
                  <span className="text-muted-foreground">○</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Position Distribution */}
      <div className="bg-white rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Position Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(analytics.positionCounts).map(([position, count]) => (
            <div key={position} className="text-center p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold text-foreground">{count}</div>
              <div className="text-sm text-muted-foreground">{position}</div>
              <div className="text-xs text-muted-foreground">
                {((count / analytics.totalPicks) * 100).toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Participant Performance */}
      <div className="bg-white rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Participant Performance</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Participant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Picks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Avg Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Auto-Picks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {analytics.participantStats.map((participant) => (
                <tr key={participant.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-sm font-medium text-foreground">
                            {participant.displayName?.trim()?.charAt(0) ||
                              participant.id?.charAt(0) ||
                              '?'}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-foreground">
                          {participant.displayName}
                        </div>
                        <div className="text-sm text-muted-foreground">{participant.teamName}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {participant.picks}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {participant.avgPickTime > 0 ? `${participant.avgPickTime.toFixed(1)}s` : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {participant.autoPicks}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        participant.isOnline
                          ? 'bg-success/10 text-success'
                          : 'bg-destructive/10 text-destructive'
                      }`}
                    >
                      {participant.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
