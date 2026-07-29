import { randomBytes } from 'crypto';
import {
  DraftType,
  LeagueRole,
  PickOrder,
  TradeReviewMode,
  WaiverRule,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { buildExternalUserEmail } from '@/lib/prismaLeagueBridge';
import { getLeagueMemberDocId, toCanonicalLeagueMembershipData } from '@/lib/leagueMembership';
import {
  normalizeCreateLeagueInput,
  type NormalizedCreateLeagueInput,
} from '@/server/leagues/createLeagueContract';
import {
  LEAGUE_CONSTRAINTS,
  type CreateLeagueRequest,
  type League,
  type LeagueMember,
} from '@/types/leagues';
import {
  REAL_DATA_NINE_CATEGORY_PRESET,
  isFantasyCategoryKey,
  normalizeFantasyCategoryKeys,
} from '@/types/fantasyCategories';

type LeagueCreationClient = Pick<PrismaClient, '$transaction' | 'league'>;
const COMPATIBILITY_PROJECTION_ATTEMPTS = 3;

export interface CreateLeagueIdentity {
  leagueId?: string;
  inviteCode?: string;
  createdAt?: Date;
}

export interface CreateLeagueCommand {
  userId: string;
  input: CreateLeagueRequest;
  identity?: CreateLeagueIdentity;
}

export interface CanonicalLeagueCreation {
  league: League;
  ownerMember: Omit<LeagueMember, 'id'> & { id: string };
  settingsId: string;
  seasonId: string;
}

interface CreateLeagueDependencies {
  prisma?: LeagueCreationClient;
  firestore?: Firestore;
  now?: () => Date;
  generateInviteCode?: () => string;
}

export class LeagueCreationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'VALIDATION' | 'CONFLICT' | 'PROJECTION'
  ) {
    super(message);
    this.name = 'LeagueCreationError';
  }
}

export async function createLeague(
  command: CreateLeagueCommand,
  dependencies: CreateLeagueDependencies = {}
): Promise<CanonicalLeagueCreation> {
  const creation = await createCanonicalLeague(command, dependencies);
  const firestore = dependencies.firestore ?? adminDb;

  for (let attempt = 1; attempt <= COMPATIBILITY_PROJECTION_ATTEMPTS; attempt++) {
    try {
      await projectLeagueCreation(creation, firestore);
      return creation;
    } catch (projectionError) {
      logger.warn('League compatibility projection attempt failed', {
        leagueId: creation.league.id,
        attempt,
        maxAttempts: COMPATIBILITY_PROJECTION_ATTEMPTS,
        projectionError:
          projectionError instanceof Error ? projectionError.message : String(projectionError),
      });
    }
  }

  logger.error('League created canonically with compatibility projection pending', {
    leagueId: creation.league.id,
    attempts: COMPATIBILITY_PROJECTION_ATTEMPTS,
  });
  return creation;
}

export async function createCanonicalLeague(
  command: CreateLeagueCommand,
  dependencies: CreateLeagueDependencies = {}
): Promise<CanonicalLeagueCreation> {
  const client = dependencies.prisma ?? prisma;
  const now = command.identity?.createdAt ?? dependencies.now?.() ?? new Date();
  const normalized = normalizeAndValidateInput(command.input);
  const draftStart = parseDraftStart(command.input.draftDate);
  const tradeDeadline = command.input.tradeSettings?.tradeDeadline
    ? parseValidatedDate(command.input.tradeSettings.tradeDeadline, 'Trade deadline')
    : null;
  const description = normalizeDescription(command.input.description);
  const inviteCode = await reserveInviteCode(command, client, dependencies.generateInviteCode);
  const memberId = command.identity?.leagueId
    ? getLeagueMemberDocId(command.identity.leagueId, command.userId)
    : undefined;

  try {
    return await client.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: command.userId },
        update: {},
        create: {
          id: command.userId,
          email: buildExternalUserEmail(command.userId),
          passwordHash: 'firebase-auth',
          displayName: `${normalized.name} Owner`,
          timeZone: normalized.timeZone,
        },
      });

      const settings = await tx.leagueSettings.create({
        data: buildSettingsData(command.input, normalized, draftStart, tradeDeadline),
      });
      const league = await tx.league.create({
        data: {
          ...(command.identity?.leagueId ? { id: command.identity.leagueId } : {}),
          name: normalized.name,
          inviteCode,
          ownerId: command.userId,
          settingsId: settings.id,
          categoriesJson: JSON.stringify(normalized.categories),
          visibility: normalized.visibility,
          description,
          createdAt: now,
        },
      });

      const year = (draftStart ?? now).getUTCFullYear();
      const season = await tx.leagueSeason.create({
        data: {
          leagueId: league.id,
          label: `${year} season`,
          year,
          startsAt: new Date(Date.UTC(year, 0, 1)),
          endsAt: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
        },
      });
      await tx.league.update({
        where: { id: league.id },
        data: { activeSeasonId: season.id },
      });

      const ownerMember = await tx.leagueMember.create({
        data: {
          ...(memberId ? { id: memberId } : {}),
          leagueId: league.id,
          userId: command.userId,
          role: LeagueRole.OWNER,
          teamName: `${normalized.name} Owner`,
          joinedAt: now,
          isActive: true,
          status: 'ACTIVE',
        },
      });

      return {
        league: buildLeagueResponse({
          command,
          normalized,
          id: league.id,
          inviteCode,
          createdAt: now,
          draftStart,
          description,
        }),
        ownerMember: {
          id: ownerMember.id,
          leagueId: league.id,
          userId: command.userId,
          role: 'owner',
          teamName: ownerMember.teamName,
          joinedAt: ownerMember.joinedAt.toISOString(),
          isActive: ownerMember.isActive,
        },
        settingsId: settings.id,
        seasonId: season.id,
      };
    });
  } catch (error) {
    if (isInviteCodeUniqueConstraintError(error)) {
      throw new LeagueCreationError(
        'That league code was just claimed. Please try creating the league again.',
        409,
        'CONFLICT'
      );
    }
    throw error;
  }
}

async function projectLeagueCreation(
  creation: CanonicalLeagueCreation,
  firestore: Firestore
): Promise<void> {
  const leagueRef = firestore.collection('leagues').doc(creation.league.id);
  const topLevelMemberRef = firestore.collection('leagueMembers').doc(creation.ownerMember.id);
  const embeddedMemberRef = leagueRef.collection('members').doc(creation.ownerMember.userId);
  const batch = firestore.batch();
  const { id: _leagueId, ...leagueData } = creation.league;
  const { id: _ownerMemberId, ...ownerMemberData } = creation.ownerMember;
  const canonicalMemberData = toCanonicalLeagueMembershipData(ownerMemberData);

  batch.set(leagueRef, leagueData, { merge: true });
  batch.set(topLevelMemberRef, canonicalMemberData, { merge: true });
  batch.set(embeddedMemberRef, canonicalMemberData, { merge: true });
  await batch.commit();
}

function normalizeAndValidateInput(input: CreateLeagueRequest): NormalizedCreateLeagueInput {
  if (
    Array.isArray(input.categories) &&
    input.categories.some((key) => !isFantasyCategoryKey(key))
  ) {
    throw new LeagueCreationError('One or more scoring categories are invalid', 400, 'VALIDATION');
  }
  const suppliedCategories = Array.isArray(input.categories)
    ? normalizeFantasyCategoryKeys(input.categories, [])
    : [...REAL_DATA_NINE_CATEGORY_PRESET];
  if (
    suppliedCategories.length < LEAGUE_CONSTRAINTS.categories.min ||
    suppliedCategories.length > LEAGUE_CONSTRAINTS.categories.max
  ) {
    throw new LeagueCreationError(
      `Select ${LEAGUE_CONSTRAINTS.categories.min}-${LEAGUE_CONSTRAINTS.categories.max} scoring categories`,
      400,
      'VALIDATION'
    );
  }
  const normalized = normalizeCreateLeagueInput({ ...input, categories: suppliedCategories });

  if (
    normalized.name.length < LEAGUE_CONSTRAINTS.name.minLength ||
    normalized.name.length > LEAGUE_CONSTRAINTS.name.maxLength
  ) {
    throw new LeagueCreationError(
      `League name must be ${LEAGUE_CONSTRAINTS.name.minLength}-${LEAGUE_CONSTRAINTS.name.maxLength} characters`,
      400,
      'VALIDATION'
    );
  }
  if (
    normalized.maxTeams < LEAGUE_CONSTRAINTS.maxTeams.min ||
    normalized.maxTeams > LEAGUE_CONSTRAINTS.maxTeams.max
  ) {
    throw new LeagueCreationError(
      `League size must be ${LEAGUE_CONSTRAINTS.maxTeams.min}-${LEAGUE_CONSTRAINTS.maxTeams.max} teams`,
      400,
      'VALIDATION'
    );
  }
  return normalized;
}

function parseDraftStart(value: string | undefined): Date | null {
  if (!value) return null;
  return parseValidatedDate(value, 'Draft date');
}

function normalizeDescription(value: string | undefined): string | null {
  if (!value) return null;
  const description = value.trim();
  if (!description) return null;
  if (description.length > LEAGUE_CONSTRAINTS.description.maxLength) {
    throw new LeagueCreationError(
      `League description must be ${LEAGUE_CONSTRAINTS.description.maxLength} characters or fewer`,
      400,
      'VALIDATION'
    );
  }
  return description;
}

function parseValidatedDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new LeagueCreationError(`${label} must be a valid ISO date`, 400, 'VALIDATION');
  }
  return date;
}

function isInviteCodeUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false;
  }

  const target =
    'meta' in error ? (error.meta as { target?: unknown } | undefined)?.target : undefined;
  const values = Array.isArray(target) ? target : [target];
  return values.some((value) => typeof value === 'string' && value.includes('inviteCode'));
}

async function reserveInviteCode(
  command: CreateLeagueCommand,
  client: LeagueCreationClient,
  generateInviteCode = defaultInviteCode
): Promise<string> {
  const requestedCode = command.identity?.inviteCode;
  const attempts = requestedCode ? 1 : 10;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const inviteCode = requestedCode ?? generateInviteCode();
    const existing = await client.league.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!existing || existing.id === command.identity?.leagueId) return inviteCode;
  }

  throw new LeagueCreationError('Could not allocate a unique league code', 409, 'CONFLICT');
}

function defaultInviteCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(LEAGUE_CONSTRAINTS.code.length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function buildSettingsData(
  input: CreateLeagueRequest,
  normalized: NormalizedCreateLeagueInput,
  draftStart: Date | null,
  tradeDeadline: Date | null
): Prisma.LeagueSettingsCreateInput {
  return {
    rosterSize: 18,
    benchSize: 4,
    maxTeams: normalized.maxTeams,
    pickSeconds: 120,
    allowAutoPick: true,
    draftType: input.draftType === 'linear' ? DraftType.LINEAR : DraftType.SNAKE,
    pickOrder: input.pickOrder === 'manual' ? PickOrder.MANUAL : PickOrder.RANDOM,
    waiverRule: input.waiverRule === 'rolling' ? WaiverRule.ROLLING : WaiverRule.WEEKLY,
    startAt: draftStart,
    timeZone: normalized.timeZone,
    locked: false,
    scoringMode: normalized.scoringMode,
    fixtureGenerationMode: normalized.fixtureGenerationMode,
    lineupSlotsJson: JSON.stringify(normalized.lineupSlots),
    categoryDirectionsJson: JSON.stringify(normalized.categoryDirections),
    tradeLimit: input.tradeSettings?.tradeLimit ?? 10,
    tradeReviewMode:
      input.tradeSettings?.tradeReview === 'admin'
        ? TradeReviewMode.ADMIN
        : input.tradeSettings?.tradeReview === 'veto'
          ? TradeReviewMode.VETO
          : TradeReviewMode.NONE,
    tradeDeadline,
    tradeOfferExpiryHours: input.tradeSettings?.offerExpiryHours ?? 72,
    tradeReviewHours: input.tradeSettings?.reviewHours ?? 24,
    tradeVetoThreshold: input.tradeSettings?.vetoThreshold ?? 3,
  };
}

function buildLeagueResponse(input: {
  command: CreateLeagueCommand;
  normalized: NormalizedCreateLeagueInput;
  id: string;
  inviteCode: string;
  createdAt: Date;
  draftStart: Date | null;
  description: string | null;
}): League {
  return {
    id: input.id,
    name: input.normalized.name,
    code: input.inviteCode,
    type: input.normalized.visibility === 'PUBLIC' ? 'public' : 'private',
    ownerId: input.command.userId,
    maxTeams: input.normalized.maxTeams,
    categories: input.normalized.categories,
    tradeSettings: {
      tradeLimit: input.command.input.tradeSettings?.tradeLimit ?? 10,
      tradeReview: input.command.input.tradeSettings?.tradeReview ?? 'none',
      ...(input.command.input.tradeSettings?.tradeDeadline
        ? { tradeDeadline: input.command.input.tradeSettings.tradeDeadline }
        : {}),
    },
    waiverWire: {
      waiverOrder: [],
      waiverPeriodHours: input.command.input.waiverWire?.waiverPeriodHours ?? 24,
      waiverResetPolicy: input.command.input.waiverRule ?? 'weekly',
    },
    createdAt: input.createdAt.toISOString(),
    status: 'preseason',
    timeZone: input.normalized.timeZone,
    ...(input.description ? { description: input.description } : {}),
    ...(input.draftStart ? { draftDate: input.draftStart.toISOString() } : {}),
    draftType: input.command.input.draftType ?? 'snake',
    pickOrder: input.command.input.pickOrder ?? 'random',
    waiverRule: input.command.input.waiverRule ?? 'weekly',
    scoringMode: input.normalized.scoringMode,
    fixtureGenerationMode: input.normalized.fixtureGenerationMode,
    lineupSlots: input.normalized.lineupSlots,
    categoryDirections: input.normalized.categoryDirections,
  };
}
