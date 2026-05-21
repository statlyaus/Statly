'use client';

/**
 * DraftOrderBar Component - Enhanced Draft Order Visualization
 *
 * An optimized component for displaying draft order in fantasy sports drafts.
 * Provides visual indicators for current pick, user's team, upcoming picks,
 * and draft progression information.
 *
 * Key Features:
 * - 🎯 Current Pick Highlighting: Animated indicator for active drafter
 * - 👤 User Team Identification: Special styling for user's team
 * - 📈 Next Pick Preview: Shows upcoming picks in snake/linear drafts
 * - 🐍 Snake Draft Support: Handles forward/reverse direction changes
 * - 📱 Mobile Responsive: Horizontal scrolling with touch support
 * - ♿ Accessibility: ARIA labels, keyboard navigation, screen reader support
 * - 🎨 Visual Polish: Gradient backgrounds, animations, status indicators
 * - 📊 Progress Tracking: Round and pick information display
 *
 * Props:
 * @param teams - Array of team objects with id and name
 * @param currentPickIndex - Zero-based index of currently picking team
 * @param myTeamId - ID of the current user's team for highlighting
 * @param currentRound - Current draft round for context (optional)
 * @param totalRounds - Total number of draft rounds (optional)
 * @param direction - Current draft direction for snake drafts
 * @param draftType - Type of draft (snake vs linear)
 * @param showTeamInfo - Whether to show legend and additional info
 * @param onTeamClick - Callback for team interaction
 * @param className - Additional CSS classes
 *
 * Usage Examples:
 * ```tsx
 * // Basic usage
 * <DraftOrderBar
 *   teams={draftTeams}
 *   currentPickIndex={3}
 *   myTeamId="user-team-123"
 * />
 *
 * // Advanced snake draft with full context
 * <DraftOrderBar
 *   teams={teams}
 *   currentPickIndex={currentPick}
 *   myTeamId={userTeamId}
 *   currentRound={5}
 *   totalRounds={15}
 *   direction="reverse"
 *   draftType="snake"
 *   onTeamClick={(team, index) => showTeamDetails(team)}
 * />
 * ```
 */

import { useMemo } from 'react';

import type { Team } from '../types/players';

interface DraftOrderBarProps {
  teams?: Team[];
  currentPickIndex: number;
  myTeamId?: string;
  /** Current round number for context */
  currentRound?: number;
  /** Total number of rounds */
  totalRounds?: number;
  /** Draft direction - forward or reverse for snake drafts */
  direction?: 'forward' | 'reverse';
  /** Whether this is a snake draft or linear */
  draftType?: 'snake' | 'linear';
  /** Show additional team info on hover/click */
  showTeamInfo?: boolean;
  /** Callback when a team is clicked for additional info */
  onTeamClick?: (team: Team, index: number) => void;
  /** Custom className for styling */
  className?: string;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

const DraftOrderBar = ({
  teams = [],
  currentPickIndex,
  myTeamId,
  currentRound = 1,
  totalRounds,
  direction = 'forward',
  draftType = 'snake',
  showTeamInfo = true,
  onTeamClick,
  className = '',
  compact = false,
}: DraftOrderBarProps) => {
  // Calculate next few picks for preview
  const nextPicksPreview = useMemo(() => {
    if (!teams.length) return [];

    const picks = [];
    const teamCount = teams.length;

    // Calculate next 3 picks
    for (let i = 1; i <= 3; i++) {
      const nextPickIndex = currentPickIndex + i;
      let nextTeamIndex;

      if (draftType === 'snake') {
        const round = Math.ceil((nextPickIndex + 1) / teamCount);
        const positionInRound = nextPickIndex % teamCount;

        if (round % 2 === 1) {
          // Forward direction
          nextTeamIndex = positionInRound;
        } else {
          // Reverse direction
          nextTeamIndex = teamCount - 1 - positionInRound;
        }
      } else {
        // Linear draft
        nextTeamIndex = nextPickIndex % teamCount;
      }

      if (nextTeamIndex >= 0 && nextTeamIndex < teamCount) {
        picks.push({
          pickNumber: nextPickIndex + 1,
          teamIndex: nextTeamIndex,
          team: teams[nextTeamIndex],
        });
      }
    }

    return picks;
  }, [teams, currentPickIndex, draftType]);

  const handleTeamClick = (team: Team, index: number) => {
    if (onTeamClick) {
      onTeamClick(team, index);
    }
  };

  // Handle empty state
  if (!teams || teams.length === 0) {
    return (
      <div className={`bg-muted border border-border rounded-lg p-4 text-center ${className}`}>
        <div className="text-muted-foreground">
          <div className="text-sm font-medium">No Teams Available</div>
          <div className="text-xs mt-1">Draft order will appear here once teams are set up</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-gradient-to-r from-muted to-info/10 border border-border rounded-lg shadow-sm ${className}`}
      role="region"
      aria-label="Draft order visualization"
    >
      {/* Header Info */}
      {!compact && (
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-foreground">Draft Order</h3>
            {currentRound && totalRounds && (
              <span className="text-xs bg-info/10 text-info px-2 py-1 rounded-full">
                Round {currentRound} of {totalRounds}
              </span>
            )}
            {draftType === 'snake' && (
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  direction === 'forward'
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                {direction === 'forward' ? '→ Forward' : '← Reverse'}
              </span>
            )}
          </div>

          {teams.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Pick {currentPickIndex + 1} of {teams.length * (totalRounds || 15)}
            </span>
          )}
        </div>
      )}

      {/* Teams Grid */}
      <div className={compact ? 'p-2' : 'p-3'}>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300">
          {teams.map((team, index) => {
            const isCurrent = index === currentPickIndex;
            const isMyTeam = team.id === myTeamId;
            const displayName = team.name || team.id;

            // Check if this team is coming up in next few picks
            const nextPickInfo = nextPicksPreview.find((pick) => pick.teamIndex === index);

            return (
              <div key={team.id} className="flex flex-col items-center gap-1 min-w-0">
                {/* Team Circle */}
                <button
                  onClick={() => handleTeamClick(team, index)}
                  disabled={!onTeamClick}
                  className={`relative ${compact ? 'w-8 h-8' : 'w-12 h-12'} rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-1 ${
                    isCurrent
                      ? 'bg-destructive text-white border-destructive/20 animate-pulse shadow-lg ring-2 ring-destructive'
                      : isMyTeam
                        ? 'bg-info text-white border-info/20 shadow-md ring-2 ring-info'
                        : nextPickInfo
                          ? 'bg-warning text-foreground border-warning/20 shadow-sm'
                          : 'bg-white text-foreground border-border hover:border-border'
                  } ${onTeamClick ? 'cursor-pointer' : 'cursor-default'}`}
                  title={`${displayName}${isCurrent ? ' (Currently Picking)' : ''}${isMyTeam ? ' (Your Team)' : ''}${nextPickInfo ? ` (Pick #${nextPickInfo.pickNumber})` : ''}`}
                  aria-label={`Team ${index + 1}: ${displayName}${isCurrent ? ', currently picking' : ''}${isMyTeam ? ', your team' : ''}`}
                >
                  {index + 1}

                  {/* Status indicators */}
                  {isCurrent && (
                    <div
                      className={`absolute -top-1 -right-1 ${compact ? 'w-3 h-3' : 'w-4 h-4'} bg-destructive rounded-full flex items-center justify-center`}
                    >
                      <div
                        className={`${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'} bg-white rounded-full animate-ping`}
                      ></div>
                    </div>
                  )}
                  {isMyTeam && !isCurrent && (
                    <div
                      className={`absolute -top-1 -right-1 ${compact ? 'w-3 h-3' : 'w-4 h-4'} bg-info rounded-full flex items-center justify-center`}
                    >
                      <span className={`text-white ${compact ? 'text-xs' : 'text-xs'}`}>★</span>
                    </div>
                  )}
                  {nextPickInfo && !isCurrent && !isMyTeam && (
                    <div
                      className={`absolute -top-1 -right-1 ${compact ? 'w-3 h-3' : 'w-4 h-4'} bg-warning rounded-full flex items-center justify-center`}
                    >
                      <span className={`text-white font-bold ${compact ? 'text-xs' : 'text-xs'}`}>
                        {nextPicksPreview.findIndex((p) => p.teamIndex === index) + 1}
                      </span>
                    </div>
                  )}
                </button>

                {/* Team Name - Hide in compact mode */}
                {!compact && (
                  <span
                    className={`text-xs text-center truncate max-w-16 ${
                      isCurrent
                        ? 'font-bold text-destructive'
                        : isMyTeam
                          ? 'font-semibold text-info'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {displayName.length > 8 ? `${displayName.slice(0, 8)}...` : displayName}
                  </span>
                )}

                {/* Next pick indicator */}
                {nextPickInfo && !compact && (
                  <span className="text-xs bg-warning/10 text-warning px-1 rounded">
                    #{nextPickInfo.pickNumber}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend - Hide in compact mode */}
        {showTeamInfo && !compact && (
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 bg-destructive rounded-full animate-pulse"></div>
              <span className="text-muted-foreground">Current Pick</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 bg-info rounded-full"></div>
              <span className="text-muted-foreground">Your Team</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 bg-warning rounded-full"></div>
              <span className="text-muted-foreground">Next Up</span>
            </div>
            {draftType === 'snake' && (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">🐍 Snake Draft</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftOrderBar;
