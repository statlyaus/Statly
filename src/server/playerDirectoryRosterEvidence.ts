import {
  normalizeLookupPart,
  normalizeTeamLookup,
} from '../../shared/player-identity/playerMatchStats';
import type {
  PlayerDirectoryPlayerRepair,
  PlayerDirectoryRegistrationRepair,
  PlayerDirectoryRepairEvidence,
  PlayerDirectoryRepairPlan,
  VALID_PLAYER_POSITIONS,
} from './playerDirectoryRepair';

export type ReviewedPlayerRosterEvidence = {
  season: number;
  playerName: string;
  club: string;
  position: (typeof VALID_PLAYER_POSITIONS)[number];
  playerStatus: 'new_player' | 'existing_player';
  playerId?: string;
  source: 'afl-official-roster' | 'club-roster' | 'manual-roster-review';
  sourceLabel: string;
  sourceUrl?: string;
  reviewedBy: string;
  reviewedAt: string;
  notes: string;
  listStatus?: string;
  active?: boolean;
  unresolved: {
    sourceDocumentIds: string[];
    sourcePlayerName: string;
    sourceTeam?: string | null;
  };
};

function deterministicPlayerId(playerName: string): string {
  return normalizeLookupPart(playerName)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function rosterNotes(evidence: ReviewedPlayerRosterEvidence): string {
  const sourceUrl = evidence.sourceUrl ? ` (${evidence.sourceUrl})` : '';
  return `Roster evidence: ${evidence.sourceLabel}${sourceUrl}. ${evidence.notes}`;
}

function repairEvidence(evidence: ReviewedPlayerRosterEvidence): PlayerDirectoryRepairEvidence {
  return {
    source: 'footywire-unresolved-row',
    sourceDocumentIds: evidence.unresolved.sourceDocumentIds,
    sourcePlayerName: evidence.unresolved.sourcePlayerName,
    sourceTeam: evidence.unresolved.sourceTeam,
    reviewedAt: evidence.reviewedAt,
  };
}

function playerIdForEvidence(evidence: ReviewedPlayerRosterEvidence): string {
  return evidence.playerId ?? deterministicPlayerId(evidence.playerName);
}

function buildPlayerRepair(
  evidence: ReviewedPlayerRosterEvidence
): PlayerDirectoryPlayerRepair | null {
  if (evidence.playerStatus !== 'new_player') return null;
  return {
    id: playerIdForEvidence(evidence),
    name: evidence.playerName,
    club: evidence.club,
    position: evidence.position,
    active: evidence.active ?? true,
    approvedBy: evidence.reviewedBy,
    notes: rosterNotes(evidence),
    evidence: repairEvidence(evidence),
  };
}

function buildRegistrationRepair(
  evidence: ReviewedPlayerRosterEvidence
): PlayerDirectoryRegistrationRepair {
  return {
    playerId: playerIdForEvidence(evidence),
    season: evidence.season,
    club: evidence.club,
    position: evidence.position,
    listStatus: evidence.listStatus ?? 'active',
    active: evidence.active ?? true,
    approvedBy: evidence.reviewedBy,
    notes: rosterNotes(evidence),
    evidence: repairEvidence(evidence),
  };
}

export function buildPlayerDirectoryRepairPlanFromRosterEvidence(
  rosterEvidence: ReviewedPlayerRosterEvidence[],
  manualPlan: PlayerDirectoryRepairPlan = {
    players: [],
    aliases: [],
    registrations: [],
    unresolvedDecisions: [],
  }
): PlayerDirectoryRepairPlan {
  const players = rosterEvidence.flatMap((evidence) => {
    const player = buildPlayerRepair(evidence);
    return player ? [player] : [];
  });
  const registrations = rosterEvidence.map(buildRegistrationRepair);

  return {
    players: [...players, ...manualPlan.players],
    aliases: manualPlan.aliases,
    registrations: [...registrations, ...manualPlan.registrations],
    unresolvedDecisions: manualPlan.unresolvedDecisions,
  };
}

export function rosterEvidenceKey(evidence: ReviewedPlayerRosterEvidence): string {
  return [
    evidence.season,
    normalizeTeamLookup(evidence.club),
    normalizeLookupPart(evidence.playerName),
  ].join('|');
}
