// League settings that stop being editable once the season they shape has started.
//
// Scoring (categories, their directions, the scoring mode and lineup slots) locks when the
// competition is published: fixtures and every later result are computed from it.
// Draft structure (roster and bench sizes, draft type, pick order, the league format and the
// Bloodsucker member) locks once the draft has started (`hasDraftStarted`): picks already made were
// made against it, including a LIVE draft rescheduled back to SCHEDULED with its picks kept.

export type LeagueSettingsLockCode = 'SCORING_SETTINGS_LOCKED' | 'DRAFT_STRUCTURE_LOCKED';

export interface LeagueSettingsLocks {
  scoring: string | null;
  draftStructure: string | null;
}

export function getScoringSettingsLockedAt(settings: {
  scoringSettingsLockedAt: Date | null;
  competitionPublishedAt?: Date | null;
}): Date | null {
  // Leagues published before publication wrote the lock are locked from their publication date.
  return settings.scoringSettingsLockedAt ?? settings.competitionPublishedAt ?? null;
}

export function getLeagueSettingsLocks({
  scoringSettingsLockedAt,
  draftStarted,
}: {
  scoringSettingsLockedAt: Date | null;
  draftStarted: boolean;
}): LeagueSettingsLocks {
  return {
    scoring: scoringSettingsLockedAt
      ? `Scoring settings are locked because the competition was published on ${scoringSettingsLockedAt
          .toISOString()
          .slice(0, 10)}.`
      : null,
    draftStructure: draftStarted
      ? 'Draft structure is locked because the draft has started.'
      : null,
  };
}
