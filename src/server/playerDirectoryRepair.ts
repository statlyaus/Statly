import type {
  PlayerAliasSource,
  Prisma,
  PrismaClient,
  UnresolvedPlayerStatStatus,
} from '@prisma/client';

import {
  buildPlayerAliasCreateInput,
  buildPlayerAliasScopeKey,
} from '@/server/playerIdentityResolver';
import {
  buildNameVariants,
  normalizeLookupPart,
  normalizeTeamLookup,
} from '../../shared/player-identity/playerMatchStats';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const VALID_PLAYER_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;

export type PlayerDirectoryRepairEvidence = {
  source: 'footywire-unresolved-row';
  sourceDocumentIds: string[];
  sourcePlayerName: string;
  sourceTeam?: string | null;
  reviewedAt: string;
};

export type PlayerDirectoryPlayerRepair = {
  id: string;
  name: string;
  club: string;
  position: (typeof VALID_PLAYER_POSITIONS)[number];
  active?: boolean;
  approvedBy: string;
  notes: string;
  evidence: PlayerDirectoryRepairEvidence;
};

export type PlayerDirectoryAliasRepair = {
  playerId: string;
  aliasName: string;
  club?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
  source?: PlayerAliasSource;
  confidence?: number;
  approvedBy: string;
  notes: string;
  evidence: PlayerDirectoryRepairEvidence;
};

export type PlayerDirectoryRegistrationRepair = {
  playerId: string;
  season: number;
  club: string;
  position: (typeof VALID_PLAYER_POSITIONS)[number];
  listStatus?: string;
  active?: boolean;
  source?: PlayerAliasSource;
  approvedBy: string;
  notes: string;
  evidence: PlayerDirectoryRepairEvidence;
};

export type PlayerDirectoryUnresolvedDecision = {
  season: number;
  playerName: string;
  team?: string | null;
  status: Extract<UnresolvedPlayerStatStatus, 'REVIEWED' | 'DISMISSED'>;
  approvedBy: string;
  notes: string;
  evidence: PlayerDirectoryRepairEvidence;
};

export type PlayerDirectoryRepairPlan = {
  players: PlayerDirectoryPlayerRepair[];
  aliases: PlayerDirectoryAliasRepair[];
  registrations: PlayerDirectoryRegistrationRepair[];
  unresolvedDecisions: PlayerDirectoryUnresolvedDecision[];
};

export type PlayerDirectoryRepairDiff = {
  playersToCreate: PlayerDirectoryPlayerRepair[];
  aliasesToCreate: Array<PlayerDirectoryAliasRepair & { scopeKey: string }>;
  registrationsToCreate: PlayerDirectoryRegistrationRepair[];
  unresolvedDecisionsToApply: Array<PlayerDirectoryUnresolvedDecision & { matchingRows: number }>;
  existingPlayers: string[];
  existingAliases: string[];
  existingRegistrations: string[];
};

export type PlayerDirectoryRepairValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  diff: PlayerDirectoryRepairDiff;
};

type UnresolvedPlayerDirectoryNearMatchReason =
  | 'name_variant'
  | 'same_team_and_surname'
  | 'same_surname';

export type UnresolvedPlayerDirectoryAuditGroup = {
  normalizedPlayerName: string;
  normalizedTeam: string;
  playerName: string;
  team: string | null;
  count: number;
  rounds: number[];
  sourceDocumentIds: string[];
  nearMatches: Array<{
    id: string;
    name: string;
    club: string;
    reason: UnresolvedPlayerDirectoryNearMatchReason;
  }>;
  recommendedRepair: {
    action:
      | 'candidate_alias'
      | 'candidate_registration'
      | 'candidate_player_or_registration'
      | 'manual_review';
    reason: UnresolvedPlayerDirectoryNearMatchReason | 'no_directory_match';
  };
};

function aliasKey(input: {
  playerId: string;
  aliasName?: string;
  normalizedAliasName?: string;
  club?: string | null;
  normalizedClub?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
}): string {
  const normalizedAliasName = input.normalizedAliasName ?? normalizeLookupPart(input.aliasName);
  const scopeKey = buildPlayerAliasScopeKey({
    club: input.club,
    normalizedClub: input.normalizedClub,
    seasonFrom: input.seasonFrom,
    seasonTo: input.seasonTo,
  });
  return [input.playerId, normalizedAliasName, scopeKey].join('|');
}

function aliasScopeKey(input: {
  club?: string | null;
  normalizedClub?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
}): string {
  return buildPlayerAliasScopeKey(input);
}

function registrationKey(input: {
  playerId: string;
  season: number;
  club?: string | null;
  normalizedClub?: string | null;
}): string {
  const normalizedClub = input.normalizedClub ?? normalizeTeamLookup(input.club);
  return `${input.playerId}|${input.season}|${normalizedClub}`;
}

function requireReviewedFields(
  item: { approvedBy?: string | null; notes?: string | null },
  label: string,
  errors: string[]
): void {
  if (!item.approvedBy?.trim()) errors.push(`${label} is missing approvedBy`);
  if (!item.notes?.trim()) errors.push(`${label} is missing notes`);
}

function requireEvidenceFields(
  item: { evidence?: PlayerDirectoryRepairEvidence | null },
  label: string,
  errors: string[]
): void {
  const evidence = item.evidence;
  if (!evidence) {
    errors.push(`${label} is missing evidence.sourceDocumentIds`);
    return;
  }
  if (evidence.source !== 'footywire-unresolved-row') {
    errors.push(`${label} has invalid evidence.source`);
  }
  if (
    !Array.isArray(evidence.sourceDocumentIds) ||
    evidence.sourceDocumentIds.length === 0 ||
    evidence.sourceDocumentIds.some((sourceDocumentId) => !sourceDocumentId.trim())
  ) {
    errors.push(`${label} is missing evidence.sourceDocumentIds`);
  }
  if (!evidence.sourcePlayerName?.trim()) {
    errors.push(`${label} is missing evidence.sourcePlayerName`);
  }
  const reviewedAtTime = Date.parse(evidence.reviewedAt);
  if (!evidence.reviewedAt?.trim() || Number.isNaN(reviewedAtTime)) {
    errors.push(`${label} has invalid evidence.reviewedAt`);
  }
}

function notesWithEvidence(item: {
  notes: string;
  evidence: PlayerDirectoryRepairEvidence;
}): string {
  return `${item.notes} Evidence: ${JSON.stringify(item.evidence)}`;
}

function validateSeasonRange(
  item: { seasonFrom?: number | null; seasonTo?: number | null },
  label: string,
  errors: string[]
): void {
  if (
    item.seasonFrom != null &&
    item.seasonTo != null &&
    Number.isInteger(item.seasonFrom) &&
    Number.isInteger(item.seasonTo) &&
    item.seasonFrom > item.seasonTo
  ) {
    errors.push(`${label} has seasonFrom after seasonTo`);
  }
}

function surnameToken(value: string): string {
  const variants = buildNameVariants(value);
  const first = variants[0] ?? normalizeLookupPart(value);
  return first.split(/\s+/).filter(Boolean).at(-1) ?? '';
}

function findNearMatches(
  playerName: string,
  normalizedTeam: string,
  players: Array<{ id: string; name: string; club: string }>
): UnresolvedPlayerDirectoryAuditGroup['nearMatches'] {
  const targetVariants = new Set(buildNameVariants(playerName));
  const targetSurname = surnameToken(playerName);
  if (!targetSurname && targetVariants.size === 0) return [];

  return players
    .flatMap((player) => {
      const sameTeam = normalizeTeamLookup(player.club) === normalizedTeam;
      const sameNameVariant = buildNameVariants(player.name).some((variant) =>
        targetVariants.has(variant)
      );
      const playerSurname = surnameToken(player.name);
      const sameSurname = playerSurname === targetSurname;
      if (!sameNameVariant && !sameSurname) return [];
      const reason: UnresolvedPlayerDirectoryNearMatchReason = sameNameVariant
        ? 'name_variant'
        : sameTeam && sameSurname
          ? 'same_team_and_surname'
          : 'same_surname';
      return [
        {
          id: player.id,
          name: player.name,
          club: player.club,
          reason,
        },
      ];
    })
    .slice(0, 8);
}

function recommendRepair(input: {
  normalizedTeam: string;
  nearMatches: UnresolvedPlayerDirectoryAuditGroup['nearMatches'];
}): UnresolvedPlayerDirectoryAuditGroup['recommendedRepair'] {
  const nameVariant = input.nearMatches.find((match) => match.reason === 'name_variant');
  if (nameVariant) {
    const sameClub = normalizeTeamLookup(nameVariant.club) === input.normalizedTeam;
    return {
      action: sameClub ? 'candidate_alias' : 'candidate_registration',
      reason: 'name_variant',
    };
  }

  const surnameMatch = input.nearMatches.find(
    (match) => match.reason === 'same_team_and_surname' || match.reason === 'same_surname'
  );
  if (surnameMatch) {
    return {
      action: 'manual_review',
      reason: surnameMatch.reason,
    };
  }

  return {
    action: 'candidate_player_or_registration',
    reason: 'no_directory_match',
  };
}

export async function auditUnresolvedPlayerDirectory(
  prisma: PrismaLike,
  options: {
    season: number;
    rounds?: number[];
    limit?: number;
  }
): Promise<UnresolvedPlayerDirectoryAuditGroup[]> {
  const rows = await prisma.unresolvedPlayerStatRow.findMany({
    where: {
      season: options.season,
      status: { in: ['NEW', 'REVIEWED'] },
      ...(options.rounds?.length ? { round: { in: options.rounds } } : {}),
    },
    orderBy: [{ normalizedTeam: 'asc' }, { normalizedPlayerName: 'asc' }, { createdAt: 'asc' }],
    take: options.limit,
  });
  const players = await prisma.player.findMany({
    select: { id: true, name: true, club: true },
    orderBy: [{ club: 'asc' }, { name: 'asc' }],
  });

  const groups = new Map<string, UnresolvedPlayerDirectoryAuditGroup>();
  for (const row of rows) {
    const normalizedPlayerName = row.normalizedPlayerName || normalizeLookupPart(row.playerName);
    const normalizedTeam = row.normalizedTeam || normalizeTeamLookup(row.team);
    const key = `${normalizedPlayerName}|${normalizedTeam}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (row.round != null && !existing.rounds.includes(row.round)) {
        existing.rounds.push(row.round);
      }
      existing.sourceDocumentIds.push(row.sourceDocumentId);
      continue;
    }

    const nearMatches = findNearMatches(row.playerName, normalizedTeam, players);
    groups.set(key, {
      normalizedPlayerName,
      normalizedTeam,
      playerName: row.playerName,
      team: row.team,
      count: 1,
      rounds: row.round == null ? [] : [row.round],
      sourceDocumentIds: [row.sourceDocumentId],
      nearMatches,
      recommendedRepair: recommendRepair({ normalizedTeam, nearMatches }),
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    rounds: group.rounds.sort((a, b) => a - b),
    sourceDocumentIds: [...new Set(group.sourceDocumentIds)].sort(),
  }));
}

export async function validatePlayerDirectoryRepairPlan(
  prisma: PrismaLike,
  plan: PlayerDirectoryRepairPlan
): Promise<PlayerDirectoryRepairValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const [existingPlayers, existingAliases, existingRegistrations] = await Promise.all([
    prisma.player.findMany({ select: { id: true, name: true, club: true, position: true } }),
    prisma.playerAlias.findMany({
      select: {
        playerId: true,
        aliasName: true,
        normalizedAliasName: true,
        club: true,
        normalizedClub: true,
        scopeKey: true,
        seasonFrom: true,
        seasonTo: true,
      },
    }),
    prisma.playerSeasonRegistration.findMany({
      select: {
        playerId: true,
        season: true,
        club: true,
        normalizedClub: true,
        player: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const playersById = new Map(existingPlayers.map((player) => [player.id, player]));
  const plannedPlayersById = new Map<string, PlayerDirectoryPlayerRepair>();
  const aliasTargetsByScope = new Map<string, Set<string>>();
  const playerClubSeasonIdentities = new Map<string, string>();

  for (const alias of existingAliases) {
    const scope = `${alias.normalizedAliasName}|${alias.scopeKey ?? aliasScopeKey(alias)}`;
    const targets = aliasTargetsByScope.get(scope) ?? new Set<string>();
    targets.add(alias.playerId);
    aliasTargetsByScope.set(scope, targets);
  }

  for (const registration of existingRegistrations) {
    const normalizedClub = registration.normalizedClub || normalizeTeamLookup(registration.club);
    const normalizedName = normalizeLookupPart(registration.player.name);
    playerClubSeasonIdentities.set(
      `${registration.season}|${normalizedClub}|${normalizedName}`,
      registration.playerId
    );
  }

  for (const player of plan.players) {
    const label = `Player ${player.id}`;
    requireReviewedFields(player, label, errors);
    requireEvidenceFields(player, label, errors);
    if (!player.id.trim()) errors.push(`${label} is missing id`);
    if (!player.name.trim()) errors.push(`${label} is missing name`);
    if (!normalizeTeamLookup(player.club)) errors.push(`${label} is missing valid club`);
    if (!VALID_PLAYER_POSITIONS.includes(player.position)) {
      errors.push(`${label} has invalid position ${player.position}`);
    }
    if (plannedPlayersById.has(player.id)) errors.push(`${label} is duplicated in repair plan`);
    plannedPlayersById.set(player.id, player);

    const existing = playersById.get(player.id);
    if (
      existing &&
      (existing.name !== player.name ||
        existing.club !== player.club ||
        existing.position !== player.position)
    ) {
      errors.push(`${label} already exists with different canonical facts`);
    }
  }

  const existingAliasKeys = new Set(existingAliases.map((alias) => aliasKey(alias)));
  const plannedAliasKeys = new Set<string>();
  const existingRegistrationKeys = new Set(
    existingRegistrations.map((registration) => registrationKey(registration))
  );
  const plannedRegistrationKeys = new Set<string>();

  for (const alias of plan.aliases) {
    const label = `Alias ${alias.aliasName} -> ${alias.playerId}`;
    requireReviewedFields(alias, label, errors);
    requireEvidenceFields(alias, label, errors);
    validateSeasonRange(alias, label, errors);
    if (
      alias.evidence.source === 'footywire-unresolved-row' &&
      (alias.seasonFrom == null || alias.seasonTo == null)
    ) {
      errors.push(`${label} must include seasonFrom and seasonTo for source-row repair`);
    }
    if (!playersById.has(alias.playerId) && !plannedPlayersById.has(alias.playerId)) {
      errors.push(`${label} targets unknown player`);
    }

    const key = aliasKey(alias);
    if (plannedAliasKeys.has(key)) errors.push(`${label} is duplicated in repair plan`);
    plannedAliasKeys.add(key);

    const scopeKey = aliasScopeKey(alias);
    const scope = `${normalizeLookupPart(alias.aliasName)}|${scopeKey}`;
    const existingTargets = aliasTargetsByScope.get(scope);
    if (existingTargets && (existingTargets.size > 1 || !existingTargets.has(alias.playerId))) {
      errors.push(`${label} would create an ambiguous alias scope`);
    }
    const plannedTargets = aliasTargetsByScope.get(scope) ?? new Set<string>();
    plannedTargets.add(alias.playerId);
    aliasTargetsByScope.set(scope, plannedTargets);
    if (plannedTargets.size > 1) {
      errors.push(`${label} conflicts with another planned alias target`);
    }
  }

  for (const registration of plan.registrations) {
    const label = `Registration ${registration.playerId} ${registration.season} ${registration.club}`;
    requireReviewedFields(registration, label, errors);
    requireEvidenceFields(registration, label, errors);
    if (!playersById.has(registration.playerId) && !plannedPlayersById.has(registration.playerId)) {
      errors.push(`${label} targets unknown player`);
    }
    if (!Number.isInteger(registration.season)) errors.push(`${label} has invalid season`);
    if (!normalizeTeamLookup(registration.club)) errors.push(`${label} is missing valid club`);
    if (!VALID_PLAYER_POSITIONS.includes(registration.position)) {
      errors.push(`${label} has invalid position ${registration.position}`);
    }
    const key = registrationKey(registration);
    if (plannedRegistrationKeys.has(key)) errors.push(`${label} is duplicated in repair plan`);
    plannedRegistrationKeys.add(key);

    const player =
      playersById.get(registration.playerId) ?? plannedPlayersById.get(registration.playerId);
    if (player) {
      const identityKey = [
        registration.season,
        normalizeTeamLookup(registration.club),
        normalizeLookupPart(player.name),
      ].join('|');
      const existingPlayerId = playerClubSeasonIdentities.get(identityKey);
      if (existingPlayerId && existingPlayerId !== registration.playerId) {
        errors.push(`${label} duplicates a player-club-season identity`);
      }
      playerClubSeasonIdentities.set(identityKey, registration.playerId);
    }
  }

  for (const player of plan.players) {
    const hasSameClubRegistration = plan.registrations.some(
      (registration) =>
        registration.playerId === player.id &&
        normalizeTeamLookup(registration.club) === normalizeTeamLookup(player.club)
    );
    if (!hasSameClubRegistration) {
      errors.push(`Player ${player.id} is missing same-season registration for ${player.club}`);
    }
  }

  const unresolvedDecisionsToApply = await Promise.all(
    plan.unresolvedDecisions.map(async (decision) => {
      const label = `Unresolved decision ${decision.playerName} ${decision.season}`;
      requireReviewedFields(decision, label, errors);
      requireEvidenceFields(decision, label, errors);
      if (!Number.isInteger(decision.season)) errors.push(`${label} has invalid season`);
      if (!['REVIEWED', 'DISMISSED'].includes(decision.status)) {
        errors.push(`${label} has invalid status ${decision.status}`);
      }
      if (decision.status === 'DISMISSED' && !decision.notes.startsWith('Dismissed:')) {
        errors.push(`${label} dismissal notes must begin with "Dismissed:"`);
      }
      const matchingRows = await prisma.unresolvedPlayerStatRow.count({
        where: {
          season: decision.season,
          normalizedPlayerName: normalizeLookupPart(decision.playerName),
          normalizedTeam: normalizeTeamLookup(decision.team),
          status: { in: ['NEW', 'REVIEWED'] },
        },
      });
      if (matchingRows === 0) warnings.push(`${label} matches no unresolved rows`);
      return { ...decision, matchingRows };
    })
  );

  const playersToCreate = plan.players.filter((player) => !playersById.has(player.id));
  const aliasesToCreate = plan.aliases
    .filter((alias) => !existingAliasKeys.has(aliasKey(alias)))
    .map((alias) => ({
      ...alias,
      scopeKey: aliasScopeKey(alias),
    }));
  const registrationsToCreate = plan.registrations.filter(
    (registration) => !existingRegistrationKeys.has(registrationKey(registration))
  );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    diff: {
      playersToCreate,
      aliasesToCreate,
      registrationsToCreate,
      unresolvedDecisionsToApply,
      existingPlayers: plan.players
        .filter((player) => playersById.has(player.id))
        .map((player) => player.id),
      existingAliases: plan.aliases
        .filter((alias) => existingAliasKeys.has(aliasKey(alias)))
        .map((alias) => `${alias.aliasName} -> ${alias.playerId}`),
      existingRegistrations: plan.registrations
        .filter((registration) => existingRegistrationKeys.has(registrationKey(registration)))
        .map((registration) => registrationKey(registration)),
    },
  };
}

export async function applyPlayerDirectoryRepairPlan(
  prisma: PrismaLike,
  plan: PlayerDirectoryRepairPlan,
  options: { dryRun: boolean }
): Promise<PlayerDirectoryRepairValidation & { applied: boolean }> {
  const validation = await validatePlayerDirectoryRepairPlan(prisma, plan);
  if (!validation.valid || options.dryRun) {
    return { ...validation, applied: false };
  }

  for (const player of validation.diff.playersToCreate) {
    await prisma.player.create({
      data: {
        id: player.id,
        name: player.name,
        club: player.club,
        position: player.position,
        active: player.active ?? true,
      },
    });
  }

  for (const alias of validation.diff.aliasesToCreate) {
    await prisma.playerAlias.create({
      data: buildPlayerAliasCreateInput({
        ...alias,
        source: alias.source ?? 'MANUAL',
        notes: notesWithEvidence(alias),
      }),
    });
  }

  for (const registration of validation.diff.registrationsToCreate) {
    await prisma.playerSeasonRegistration.create({
      data: {
        playerId: registration.playerId,
        season: registration.season,
        club: registration.club,
        normalizedClub: normalizeTeamLookup(registration.club),
        position: registration.position,
        listStatus: registration.listStatus ?? 'active',
        active: registration.active ?? true,
        source: registration.source ?? 'MANUAL',
        approvedBy: registration.approvedBy,
        notes: notesWithEvidence(registration),
      },
    });
  }

  for (const decision of validation.diff.unresolvedDecisionsToApply) {
    await prisma.unresolvedPlayerStatRow.updateMany({
      where: {
        season: decision.season,
        normalizedPlayerName: normalizeLookupPart(decision.playerName),
        normalizedTeam: normalizeTeamLookup(decision.team),
        status: { in: ['NEW', 'REVIEWED'] },
      },
      data: {
        status: decision.status,
        resolutionNotes: notesWithEvidence(decision),
      },
    });
  }

  return { ...validation, applied: true };
}
