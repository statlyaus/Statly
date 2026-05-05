import {
  normalizeLookupPart,
  normalizeTeamLookup,
} from '@shared/player-identity/playerMatchStats';

import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';

export const REVIEWED_ROSTER_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;

export type ReviewedRosterPosition = (typeof REVIEWED_ROSTER_POSITIONS)[number];

export type ReviewedSeasonRosterAlias = {
  aliasName: string;
  club?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
  source?: 'MANUAL' | 'FOOTYWIRE' | 'AFL_OFFICIAL' | 'CLUB_ROSTER';
  confidence?: number;
  notes: string;
};

export type ReviewedSeasonRosterEntry = {
  season: number;
  playerId: string;
  playerName: string;
  club: string;
  position: ReviewedRosterPosition;
  playerStatus: 'listed' | 'inactive' | 'delisted';
  listStatus: string;
  active: boolean;
  source: 'afl-official-roster' | 'club-roster' | 'manual-roster-review';
  sourceLabel: string;
  sourceUrl: string;
  reviewedBy: string;
  reviewedAt: string;
  notes: string;
  aliases: ReviewedSeasonRosterAlias[];
};

export type NormalizedReviewedSeasonRosterEntry = ReviewedSeasonRosterEntry & {
  normalizedPlayerName: string;
  normalizedClub: string;
};

export type ReviewedSeasonRosterValidation = {
  valid: boolean;
  errors: string[];
  normalizedEntries: NormalizedReviewedSeasonRosterEntry[];
};

export type SeasonRosterCoverage = {
  ok: boolean;
  season: number;
  diagnosticStoredPlayerIds: string[];
  coveredStoredPlayerIds: string[];
  missingStoredPlayerIds: string[];
};

function stablePlayerId(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function reviewedAtIsValid(value: string): boolean {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;

  const [, yearPart, monthPart, dayPart] = match;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function validateReviewedSeasonRoster(params: {
  season: number;
  entries: ReviewedSeasonRosterEntry[];
}): ReviewedSeasonRosterValidation {
  const errors: string[] = [];
  const normalizedEntries = params.entries.map((entry) => ({
    ...entry,
    playerId: stablePlayerId(entry.playerId),
    normalizedPlayerName: normalizeLookupPart(entry.playerName),
    normalizedClub: normalizeTeamLookup(entry.club),
  }));
  const byPlayerId = new Map<string, NormalizedReviewedSeasonRosterEntry>();

  for (const entry of normalizedEntries) {
    const label = `Player ${entry.playerId || '<missing id>'}`;

    if (entry.season !== params.season) {
      errors.push(`${label} has season ${entry.season}, expected ${params.season}`);
    }

    if (!entry.playerId) errors.push(`${label} is missing playerId`);
    if (!entry.playerName.trim()) errors.push(`${label} is missing playerName`);
    if (!entry.club.trim() || !entry.normalizedClub) errors.push(`${label} is missing club`);
    if (!REVIEWED_ROSTER_POSITIONS.includes(entry.position)) {
      errors.push(`${label} has invalid position ${entry.position}`);
    }
    if (!entry.reviewedBy.trim()) errors.push(`${label} is missing reviewedBy`);
    if (!reviewedAtIsValid(entry.reviewedAt)) errors.push(`${label} has invalid reviewedAt`);
    if (!entry.sourceLabel.trim()) errors.push(`${label} is missing sourceLabel`);
    if (!entry.sourceUrl.trim()) errors.push(`${label} is missing sourceUrl`);
    if (!entry.notes.trim()) errors.push(`${label} is missing notes`);

    const existing = byPlayerId.get(entry.playerId);
    if (existing) {
      errors.push(`${label} appears more than once`);
      if (
        existing.normalizedPlayerName !== entry.normalizedPlayerName ||
        existing.normalizedClub !== entry.normalizedClub ||
        existing.position !== entry.position
      ) {
        errors.push(`${label} appears more than once with conflicting canonical facts`);
      }
    }
    if (entry.playerId) byPlayerId.set(entry.playerId, entry);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedEntries,
  };
}

export function buildSeasonRosterCoverage(params: {
  season: number;
  rosterEntries: ReviewedSeasonRosterEntry[];
  diagnosticRows: IdentityGapDiagnosticRow[];
}): SeasonRosterCoverage {
  const reviewedPlayerIds = new Set(
    params.rosterEntries
      .filter((entry) => entry.season === params.season)
      .map((entry) => stablePlayerId(entry.playerId))
      .filter(Boolean)
  );
  const diagnosticStoredPlayerIds = [
    ...new Set(
      params.diagnosticRows
        .filter((row) => row.classification === 'player_id_not_in_prisma')
        .filter((row) => row.season === params.season)
        .map((row) => stablePlayerId(row.stored_player_id))
        .filter(Boolean)
    ),
  ].sort();
  const coveredStoredPlayerIds = diagnosticStoredPlayerIds.filter((playerId) =>
    reviewedPlayerIds.has(playerId)
  );
  const missingStoredPlayerIds = diagnosticStoredPlayerIds.filter(
    (playerId) => !reviewedPlayerIds.has(playerId)
  );

  return {
    ok: missingStoredPlayerIds.length === 0,
    season: params.season,
    diagnosticStoredPlayerIds,
    coveredStoredPlayerIds,
    missingStoredPlayerIds,
  };
}
