import { randomUUID } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';
import { groupWaiverPlayersByIdentity } from '@/server/waivers/waiverPlayerIdentity';

export interface WaiverSettings {
  system?: 'FAAB' | 'PRIORITY' | string;
  faabBudget?: number;
  minimumBid?: number;
  waiverPeriodHours?: number;
}

export interface WaiverClaim {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  waiverPriority?: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED' | string;
  createdAt: Date;
  processingAt?: Date;
  bidAmount?: number;
  canonicalActionId?: string;
}

export interface WaiverProcessingResult {
  processed: number;
  results: Array<{ id: string; status: string; reason?: string }>;
}

interface PriorityEntry {
  userId: string;
  priority: number;
}

interface ClaimStore {
  loadWaiverSettings?(leagueId: string): Promise<WaiverSettings>;
  loadPendingClaims?(leagueId: string): Promise<WaiverClaim[]>;
  markSuccessful(input: { leagueId: string; claimId: string; claim: WaiverClaim }): Promise<void>;
  markFailed(input: {
    leagueId: string;
    claimId: string;
    claim: WaiverClaim;
    reason: string;
  }): Promise<void>;
  recordActivity(input: {
    leagueId: string;
    claim: WaiverClaim;
    type: 'waiver-submitted' | 'waiver-successful' | 'waiver-failed';
    reason?: string;
  }): Promise<void>;
  decrementPendingBidTotal(claim: WaiverClaim, isFAAB: boolean): Promise<void>;
  debitFaab(
    claim: WaiverClaim,
    waiverSettings: WaiverSettings
  ): Promise<{ ok: boolean; reason?: string }>;
  refundFaab?(claim: WaiverClaim): Promise<void>;
  advancePriority(leagueId: string, userId: string): Promise<void>;
}

export interface SubmitWaiverClaimInput {
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  bidAmount?: number;
  waiverSettings: WaiverSettings;
}

export interface CancelWaiverClaimInput {
  leagueId: string;
  claimId: string;
  claim: WaiverClaim;
  cancelledBy: string;
}

export class WaiverClaimStoreError extends Error {
  constructor(
    readonly code:
      | 'TEAM_NOT_FOUND'
      | 'INSUFFICIENT_FAAB'
      | 'FAAB_BALANCE_UNAVAILABLE'
      | 'CLAIM_NOT_FOUND'
      | 'CLAIM_NOT_PENDING',
    message: string
  ) {
    super(message);
    this.name = 'WaiverClaimStoreError';
  }
}

type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type PrismaLike = Pick<
  typeof prisma,
  | '$transaction'
  | 'league'
  | 'leagueMember'
  | 'leagueRoster'
  | 'leagueRosterPlayer'
  | 'player'
  | 'teamAction'
>;

type PrismaWaiverStoreDb = Pick<
  typeof prisma,
  '$executeRaw' | '$queryRaw' | '$transaction' | 'league' | 'leagueMember' | 'teamAction'
>;

type FirestoreLike = Pick<typeof adminDb, 'collection' | 'doc'>;

type ProjectionLike = Pick<WaiverAvailabilityProjectionService, 'projectLeague'>;

type CanonicalRosterPlan =
  | { status: 'READY'; memberId: string; playerId: string; nextPlayerIds: string }
  | { status: 'FAILED'; reason: string };

function parsePlayerIds(raw?: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function stringifyPlayerIds(playerIds: string[]): string {
  return JSON.stringify(Array.from(new Set(playerIds)));
}

function normalizeDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate(): Date }).toDate();
  }
  return new Date();
}

function toFirestoreWaiverClaim(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  leagueId: string
): WaiverClaim {
  const data = document.data();

  return {
    id: document.id,
    leagueId: typeof data.leagueId === 'string' ? data.leagueId : leagueId,
    userId: typeof data.userId === 'string' ? data.userId : '',
    teamId: typeof data.teamId === 'string' ? data.teamId : '',
    playerId: typeof data.playerId === 'string' ? data.playerId : '',
    priority: typeof data.priority === 'number' ? data.priority : 1,
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    createdAt: normalizeDate(data.createdAt),
    ...(typeof data.dropPlayerId === 'string' ? { dropPlayerId: data.dropPlayerId } : {}),
    ...(typeof data.bidAmount === 'number' ? { bidAmount: data.bidAmount } : {}),
  };
}

async function loadWaiverPriorityByUserId(leagueId: string): Promise<Map<string, number>> {
  const prioritySnap = await adminDb.collection(`leagues/${leagueId}/waiverPriorities`).get();
  const priorityByUserId = new Map<string, number>();

  for (const document of prioritySnap.docs) {
    const data = document.data();
    const userId = typeof data.userId === 'string' ? data.userId : document.id;

    if (typeof data.priority === 'number') {
      priorityByUserId.set(userId, data.priority);
    }
  }

  return priorityByUserId;
}

function applyWaiverPriorities(
  claims: WaiverClaim[],
  priorityByUserId: Map<string, number>
): WaiverClaim[] {
  return claims.map((claim) => {
    const waiverPriority = priorityByUserId.get(claim.userId);

    return typeof waiverPriority === 'number' ? { ...claim, waiverPriority } : claim;
  });
}

function parseActionDetails(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;

  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function calculateProcessingAt(settings: WaiverSettings): Date {
  const periodHours =
    typeof settings.waiverPeriodHours === 'number' && settings.waiverPeriodHours >= 0
      ? settings.waiverPeriodHours
      : 24;
  return new Date(Date.now() + periodHours * 60 * 60 * 1000);
}

function readWaiverPriority(claim: WaiverClaim): number {
  return typeof claim.waiverPriority === 'number' ? claim.waiverPriority : claim.priority;
}

function buildInitialPriorityEntries(claims: WaiverClaim[]): PriorityEntry[] {
  const priorityByUserId = new Map<string, number>();

  for (const claim of claims) {
    const existingPriority = priorityByUserId.get(claim.userId);
    const claimPriority = readWaiverPriority(claim);

    if (typeof existingPriority !== 'number' || claimPriority < existingPriority) {
      priorityByUserId.set(claim.userId, claimPriority);
    }
  }

  return [...priorityByUserId.entries()]
    .map(([userId, priority]) => ({ userId, priority }))
    .sort((a, b) => a.priority - b.priority);
}

export function sortWaiverClaims(
  claims: WaiverClaim[],
  waiverSettings: WaiverSettings
): WaiverClaim[] {
  const isFAAB = waiverSettings.system === 'FAAB';

  return [...claims].sort((a, b) => {
    if (isFAAB) {
      const bidDiff = (b.bidAmount ?? 0) - (a.bidAmount ?? 0);
      if (bidDiff !== 0) return bidDiff;
    }

    const waiverPriorityDiff = readWaiverPriority(a) - readWaiverPriority(b);
    if (waiverPriorityDiff !== 0) return waiverPriorityDiff;

    const claimPriorityDiff = a.priority - b.priority;
    if (claimPriorityDiff !== 0) return claimPriorityDiff;

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function buildAdvancedWaiverPriorityUpdates(
  entries: PriorityEntry[],
  winningUserId: string
): PriorityEntry[] {
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  const winner = sorted.find((entry) => entry.userId === winningUserId);
  if (!winner) return sorted;

  const lastPriority = Math.max(...sorted.map((entry) => entry.priority));

  return sorted
    .map((entry) => {
      if (entry.userId === winningUserId) {
        return { userId: entry.userId, priority: lastPriority };
      }

      if (entry.priority > winner.priority) {
        return { userId: entry.userId, priority: entry.priority - 1 };
      }

      return entry;
    })
    .sort((a, b) => a.priority - b.priority);
}

export class WaiverProcessingService {
  constructor(
    private readonly db: PrismaLike = prisma,
    private readonly claimStore: ClaimStore = new PrismaWaiverClaimStore(),
    private readonly projectionService: ProjectionLike = new WaiverAvailabilityProjectionService()
  ) {}

  async processLeague(input: { leagueId: string }): Promise<WaiverProcessingResult> {
    const [waiverSettings, claims] = await Promise.all([
      this.claimStore.loadWaiverSettings?.(input.leagueId) ?? Promise.resolve({}),
      this.claimStore.loadPendingClaims?.(input.leagueId) ?? Promise.resolve([]),
    ]);

    return this.processClaims({
      leagueId: input.leagueId,
      waiverSettings,
      claims,
    });
  }

  async processClaims(input: {
    leagueId: string;
    waiverSettings: WaiverSettings;
    claims: WaiverClaim[];
  }): Promise<WaiverProcessingResult> {
    const remainingClaims = input.claims.filter((claim) => claim.status === 'PENDING');
    let priorityEntries = buildInitialPriorityEntries(remainingClaims);
    const isFAAB = input.waiverSettings.system === 'FAAB';
    const results: WaiverProcessingResult['results'] = [];

    while (remainingClaims.length > 0) {
      const priorityByUserId = new Map(
        priorityEntries.map((entry) => [entry.userId, entry.priority])
      );
      const sortedClaims = sortWaiverClaims(
        remainingClaims.map((claim) => ({
          ...claim,
          waiverPriority: priorityByUserId.get(claim.userId) ?? readWaiverPriority(claim),
        })),
        input.waiverSettings
      );
      const claim = sortedClaims[0];
      if (!claim) break;

      const remainingIndex = remainingClaims.findIndex((item) => item.id === claim.id);
      if (remainingIndex >= 0) {
        remainingClaims.splice(remainingIndex, 1);
      }

      const validation = await this.validateCanonicalRosterChange(input.leagueId, claim);
      if (validation.status === 'FAILED') {
        await this.failClaim(input.leagueId, claim, validation.reason, isFAAB);
        results.push({ id: claim.id, status: 'FAILED', reason: validation.reason });
        continue;
      }

      if (isFAAB) {
        const debit = await this.claimStore.debitFaab(claim, input.waiverSettings);
        if (!debit.ok) {
          const reason = debit.reason ?? 'FAAB balance unavailable';
          await this.failClaim(input.leagueId, claim, reason, isFAAB);
          results.push({ id: claim.id, status: 'FAILED', reason });
          continue;
        }
      }

      const result = await this.applyCanonicalRosterChange(
        input.leagueId,
        claim,
        input.waiverSettings
      );

      if (result.status === 'FAILED') {
        if (isFAAB) {
          await this.claimStore.refundFaab?.(claim);
        }
        await this.failClaim(input.leagueId, claim, result.reason, isFAAB);
        results.push({ id: claim.id, status: 'FAILED', reason: result.reason });
        continue;
      }

      await this.claimStore.decrementPendingBidTotal(claim, isFAAB);
      await this.claimStore.markSuccessful({ leagueId: input.leagueId, claimId: claim.id, claim });
      await this.claimStore.recordActivity({
        leagueId: input.leagueId,
        claim,
        type: 'waiver-successful',
      });
      await this.claimStore.advancePriority(input.leagueId, claim.userId);
      priorityEntries = buildAdvancedWaiverPriorityUpdates(priorityEntries, claim.userId);
      await this.projectionService.projectLeague({ leagueId: input.leagueId });

      results.push({ id: claim.id, status: 'SUCCESSFUL' });
    }

    return { processed: results.length, results };
  }

  private async failClaim(
    leagueId: string,
    claim: WaiverClaim,
    reason: string,
    isFAAB: boolean
  ): Promise<void> {
    await this.claimStore.decrementPendingBidTotal(claim, isFAAB);
    await this.claimStore.markFailed({ leagueId, claimId: claim.id, claim, reason });
    await this.claimStore.recordActivity({ leagueId, claim, type: 'waiver-failed', reason });
  }

  private async applyCanonicalRosterChange(
    leagueId: string,
    claim: WaiverClaim,
    waiverSettings: WaiverSettings
  ): Promise<{ status: 'SUCCESSFUL' } | { status: 'FAILED'; reason: string }> {
    return this.db.$transaction(
      async (
        tx: PrismaTransactionClient
      ): Promise<{ status: 'SUCCESSFUL' } | { status: 'FAILED'; reason: string }> => {
        const plan = await this.buildCanonicalRosterPlan(tx, leagueId, claim);
        if (plan.status === 'FAILED') {
          return plan;
        }
        if (claim.dropPlayerId) {
          await tx.leagueRosterPlayer.deleteMany({
            where: { leagueId, memberId: plan.memberId, playerId: claim.dropPlayerId },
          });
          await tx.teamAction.create({
            data: {
              leagueId,
              memberId: plan.memberId,
              actionType: 'DROP_PLAYER',
              status: 'PENDING',
              details: JSON.stringify({
                playerId: claim.dropPlayerId,
                source: 'drop-to-waivers',
                waiverClaimId: claim.id,
              }),
              processingAt: calculateProcessingAt(waiverSettings),
            },
            select: { id: true },
          });
        }

        await tx.leagueRoster.upsert({
          where: { leagueId_memberId: { leagueId, memberId: plan.memberId } },
          update: { playerIds: plan.nextPlayerIds },
          create: { leagueId, memberId: plan.memberId, playerIds: plan.nextPlayerIds },
        });
        await tx.leagueRosterPlayer.upsert({
          where: { leagueId_playerId: { leagueId, playerId: plan.playerId } },
          update: {
            memberId: plan.memberId,
            draftId: null,
            pickId: null,
            acquiredBy: 'WAIVER',
            acquiredAt: new Date(),
          },
          create: {
            leagueId,
            memberId: plan.memberId,
            playerId: plan.playerId,
            acquiredBy: 'WAIVER',
            acquiredAt: new Date(),
          },
        });

        return { status: 'SUCCESSFUL' };
      }
    );
  }

  private async validateCanonicalRosterChange(
    leagueId: string,
    claim: WaiverClaim
  ): Promise<CanonicalRosterPlan> {
    return this.db.$transaction((tx: PrismaTransactionClient) =>
      this.buildCanonicalRosterPlan(tx, leagueId, claim)
    );
  }

  private async buildCanonicalRosterPlan(
    tx: PrismaTransactionClient,
    leagueId: string,
    claim: WaiverClaim
  ): Promise<CanonicalRosterPlan> {
    const league = await tx.league.findUnique({
      where: { id: leagueId },
      select: { settings: { select: { rosterSize: true } } },
    });

    if (!league) {
      return { status: 'FAILED', reason: 'League not found' };
    }

    const member = await tx.leagueMember.findFirst({
      where: {
        leagueId,
        OR: [{ id: claim.teamId }, { userId: claim.userId }],
      },
      select: { id: true },
    });

    if (!member) {
      return { status: 'FAILED', reason: 'Roster not found' };
    }

    const memberId = member.id;
    const activePlayers = await tx.player.findMany({
      where: { active: true },
      select: { id: true, name: true, club: true, position: true },
    });
    const playerGroup = groupWaiverPlayersByIdentity(activePlayers).find((group) =>
      group.aliases.some((player) => player.id === claim.playerId)
    );
    if (!playerGroup) {
      return { status: 'FAILED', reason: 'Player not found' };
    }

    const playerAliasIds = playerGroup.aliases.map((player) => player.id);
    const canonicalPlayerId = playerGroup.representative.id;
    const existingOwnership = await tx.leagueRosterPlayer.findFirst({
      where: { leagueId, playerId: { in: playerAliasIds } },
      select: { playerId: true, memberId: true },
    });

    if (existingOwnership) {
      return { status: 'FAILED', reason: 'Player already owned' };
    }

    const rosterSize = league.settings.rosterSize;
    const currentRosterCount = await tx.leagueRosterPlayer.count({
      where: { leagueId, memberId },
    });
    let nextRosterCount = currentRosterCount + 1;

    if (claim.dropPlayerId) {
      const dropOwnership = await tx.leagueRosterPlayer.findFirst({
        where: { leagueId, memberId, playerId: claim.dropPlayerId },
        select: { playerId: true },
      });

      if (!dropOwnership) {
        return { status: 'FAILED', reason: 'Drop player not on roster' };
      }

      nextRosterCount -= 1;
    }

    if (nextRosterCount > rosterSize) {
      return { status: 'FAILED', reason: 'Roster limit reached' };
    }

    const roster = await tx.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId } },
      select: { playerIds: true },
    });
    const playerIds = parsePlayerIds(roster?.playerIds)
      .filter((playerId) => playerId !== claim.dropPlayerId)
      .filter((playerId) => !playerAliasIds.includes(playerId));
    playerIds.push(canonicalPlayerId);

    return {
      status: 'READY',
      memberId,
      playerId: canonicalPlayerId,
      nextPlayerIds: stringifyPlayerIds(playerIds),
    };
  }
}

interface CanonicalWaiverActionRow {
  id: string;
  leagueId: string;
  memberId: string;
  details: unknown;
  status: string;
  processingAt?: Date | string | null;
  createdAt?: Date | string | null;
}

interface WaiverPriorityRow {
  memberId: string;
  priority: number;
  remainingFAAB?: number | null;
  pendingBidTotal?: number | null;
}

interface WaiverPriorityEntry extends PriorityEntry {
  memberId: string;
}

interface DraftWaiverPrioritySeedRow {
  memberId: string;
  finalPick: number | bigint;
}

type PrismaWaiverStoreTransaction = Omit<PrismaWaiverStoreDb, '$transaction'>;

export class PrismaWaiverClaimStore implements ClaimStore {
  constructor(
    private readonly db: PrismaWaiverStoreDb = prisma,
    private readonly firestore: FirestoreLike = adminDb
  ) {}

  async loadWaiverSettings(leagueId: string): Promise<WaiverSettings> {
    const [league, settingsSnap] = await Promise.all([
      this.db.league.findUnique({
        where: { id: leagueId },
        select: { settings: { select: { waiverRule: true } } },
      }),
      this.firestore.doc(`leagues/${leagueId}/config/settings`).get(),
    ]);
    const projectedSettings = settingsSnap.data()?.waiverSettings;
    const waiverSettings =
      projectedSettings && typeof projectedSettings === 'object'
        ? (projectedSettings as WaiverSettings)
        : {};

    return {
      system:
        waiverSettings.system ??
        (league?.settings.waiverRule === 'ROLLING' ? 'PRIORITY' : undefined),
      faabBudget: waiverSettings.faabBudget,
      minimumBid: waiverSettings.minimumBid,
      waiverPeriodHours: waiverSettings.waiverPeriodHours,
    };
  }

  async loadPendingClaims(leagueId: string): Promise<WaiverClaim[]> {
    const actions = (await this.db.teamAction.findMany({
      where: {
        leagueId,
        actionType: 'WAIVER_CLAIM',
        status: 'PENDING',
        OR: [{ processingAt: null }, { processingAt: { lte: new Date() } }],
      },
      orderBy: [{ processingAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        leagueId: true,
        memberId: true,
        details: true,
        status: true,
        processingAt: true,
        createdAt: true,
      },
    })) as CanonicalWaiverActionRow[];

    return this.mapActionsToClaims(leagueId, actions);
  }

  async loadClaim(leagueId: string, claimId: string): Promise<WaiverClaim | null> {
    const action = (await this.db.teamAction.findFirst({
      where: {
        id: claimId,
        leagueId,
        actionType: 'WAIVER_CLAIM',
      },
      select: {
        id: true,
        leagueId: true,
        memberId: true,
        details: true,
        status: true,
        processingAt: true,
        createdAt: true,
      },
    })) as CanonicalWaiverActionRow | null;

    if (!action) return null;
    const [claim] = await this.mapActionsToClaims(leagueId, [action]);
    return claim ?? null;
  }

  async submitClaim(input: SubmitWaiverClaimInput): Promise<{ id: string; processingAt: Date }> {
    const member = await this.db.leagueMember.findFirst({
      where: {
        id: input.teamId,
        leagueId: input.leagueId,
        userId: input.userId,
      },
      select: { id: true, userId: true },
    });

    if (!member) {
      throw new WaiverClaimStoreError('TEAM_NOT_FOUND', 'Team not found');
    }

    const processingAt = calculateProcessingAt(input.waiverSettings);
    const details = {
      playerId: input.playerId,
      priority: input.priority,
      source: 'league-waivers-v2',
      ...(input.dropPlayerId ? { dropPlayerId: input.dropPlayerId } : {}),
      ...(typeof input.bidAmount === 'number' ? { bidAmount: input.bidAmount } : {}),
    };

    const action = await this.db.$transaction(async (tx) => {
      await this.ensureLeaguePriorityRows(tx, input.leagueId, input.waiverSettings);

      if (input.waiverSettings.system === 'FAAB' && typeof input.bidAmount === 'number') {
        await this.reservePendingBid(tx, {
          leagueId: input.leagueId,
          memberId: member.id,
          bidAmount: input.bidAmount,
          waiverSettings: input.waiverSettings,
        });
      }

      return tx.teamAction.create({
        data: {
          leagueId: input.leagueId,
          memberId: member.id,
          actionType: 'WAIVER_CLAIM',
          status: 'PENDING',
          details: JSON.stringify(details),
          processingAt,
        },
        select: { id: true },
      });
    });

    const claim: WaiverClaim = {
      id: action.id,
      canonicalActionId: action.id,
      leagueId: input.leagueId,
      userId: input.userId,
      teamId: member.id,
      playerId: input.playerId,
      priority: input.priority,
      status: 'PENDING',
      createdAt: new Date(),
      processingAt,
      ...(input.dropPlayerId ? { dropPlayerId: input.dropPlayerId } : {}),
      ...(typeof input.bidAmount === 'number' ? { bidAmount: input.bidAmount } : {}),
    };

    try {
      await Promise.all([
        this.mirrorLeaguePriorityProjection(input.leagueId),
        this.writeSubmittedClaimProjection(claim),
        this.recordActivity({ leagueId: input.leagueId, claim, type: 'waiver-submitted' }),
      ]);
    } catch (error) {
      await this.cancelPendingClaim({
        leagueId: input.leagueId,
        claimId: action.id,
        claim,
        cancelledBy: input.userId,
      }).catch((cleanupError) => {
        logger.warn('Failed to clean up canonical waiver claim after projection failure', {
          leagueId: input.leagueId,
          claimId: action.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
      throw error;
    }

    return { id: action.id, processingAt };
  }

  async markSuccessful(input: {
    leagueId: string;
    claimId: string;
    claim: WaiverClaim;
  }): Promise<void> {
    const processedAt = new Date();
    await this.db.teamAction.update({
      where: { id: input.claimId },
      data: { status: 'PROCESSED', processedAt },
    });
    await this.updateClaimProjection(input.leagueId, input.claimId, {
      status: 'SUCCESSFUL',
      processedAt,
    });
  }

  async markFailed(input: {
    leagueId: string;
    claimId: string;
    claim: WaiverClaim;
    reason: string;
  }): Promise<void> {
    const processedAt = new Date();
    await this.db.teamAction.update({
      where: { id: input.claimId },
      data: { status: 'REJECTED', processedAt },
    });
    await this.updateClaimProjection(input.leagueId, input.claimId, {
      status: 'FAILED',
      processedAt,
      reason: input.reason,
    });
  }

  async cancelPendingClaim(input: CancelWaiverClaimInput): Promise<void> {
    const cancelledAt = new Date();
    await this.db.$transaction(async (tx) => {
      if (typeof input.claim.bidAmount === 'number' && input.claim.bidAmount > 0) {
        await this.releasePendingBid(tx, input.claim);
      }

      await tx.teamAction.update({
        where: { id: input.claimId },
        data: { status: 'CANCELLED', processedAt: cancelledAt },
      });
    });

    await this.mirrorPriorityProjection(input.leagueId, input.claim.teamId);
    await this.updateClaimProjection(input.leagueId, input.claimId, {
      status: 'CANCELLED',
      processedAt: cancelledAt,
      cancelledBy: input.cancelledBy,
      cancelledAt,
    });
  }

  async recordActivity(input: {
    leagueId: string;
    claim: WaiverClaim;
    type: 'waiver-submitted' | 'waiver-successful' | 'waiver-failed';
    reason?: string;
  }): Promise<void> {
    await this.firestore
      .collection(`leagues/${input.leagueId}/activity`)
      .doc()
      .set({
        type: input.type,
        leagueId: input.leagueId,
        userId: input.claim.userId,
        teamId: input.claim.teamId,
        playerId: input.claim.playerId,
        claimId: input.claim.id,
        timestamp: new Date(),
        ...(input.claim.dropPlayerId ? { dropPlayerId: input.claim.dropPlayerId } : {}),
        ...(typeof input.claim.bidAmount === 'number' ? { bidAmount: input.claim.bidAmount } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      });
  }

  async decrementPendingBidTotal(claim: WaiverClaim, isFAAB: boolean): Promise<void> {
    if (!isFAAB || typeof claim.bidAmount !== 'number' || claim.bidAmount <= 0) return;
    await this.releasePendingBid(this.db, claim);
    await this.mirrorPriorityProjection(claim.leagueId, claim.teamId);
  }

  async debitFaab(
    claim: WaiverClaim,
    waiverSettings: WaiverSettings
  ): Promise<{ ok: boolean; reason?: string }> {
    if (waiverSettings.system !== 'FAAB' || typeof claim.bidAmount !== 'number') {
      return { ok: true };
    }

    try {
      const result = await this.db.$transaction(async (tx) => {
        const [priority] = await this.loadPriorityRows(tx, claim.leagueId, claim.teamId);
        const remainingFAAB =
          typeof priority?.remainingFAAB === 'number'
            ? priority.remainingFAAB
            : waiverSettings.faabBudget;

        if (typeof remainingFAAB !== 'number') {
          return { ok: false, reason: 'FAAB balance unavailable' };
        }

        if (claim.bidAmount! > remainingFAAB) {
          return { ok: false, reason: 'Insufficient FAAB' };
        }

        await tx.$executeRaw`
          UPDATE WaiverPriority
          SET remainingFAAB = ${remainingFAAB - claim.bidAmount!}, updatedAt = ${new Date()}
          WHERE leagueId = ${claim.leagueId} AND memberId = ${claim.teamId}
        `;

        return { ok: true };
      });
      if (result.ok) {
        await this.mirrorPriorityProjection(claim.leagueId, claim.teamId);
      }
      return result;
    } catch (error) {
      logger.warn('Failed to debit FAAB during waiver processing', {
        leagueId: claim.leagueId,
        userId: claim.userId,
        claimId: claim.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'FAAB balance unavailable' };
    }
  }

  async refundFaab(claim: WaiverClaim): Promise<void> {
    if (typeof claim.bidAmount !== 'number' || claim.bidAmount <= 0) return;

    await this.db.$executeRaw`
      UPDATE WaiverPriority
      SET remainingFAAB = COALESCE(remainingFAAB, 0) + ${claim.bidAmount}, updatedAt = ${new Date()}
      WHERE leagueId = ${claim.leagueId} AND memberId = ${claim.teamId}
    `;
    await this.mirrorPriorityProjection(claim.leagueId, claim.teamId);
  }

  async advancePriority(leagueId: string, userId: string): Promise<void> {
    const members = await this.db.leagueMember.findMany({
      where: { leagueId },
      select: { id: true, userId: true },
    });
    const userIdByMemberId = new Map(members.map((member) => [member.id, member.userId]));
    const memberIdByUserId = new Map(members.map((member) => [member.userId, member.id]));
    const entries: WaiverPriorityEntry[] = (await this.loadPriorityRows(this.db, leagueId))
      .map((row) => {
        const rowUserId = userIdByMemberId.get(row.memberId);
        if (!rowUserId) return null;
        return { memberId: row.memberId, userId: rowUserId, priority: row.priority };
      })
      .filter((row): row is WaiverPriorityEntry => row !== null);

    const updates = buildAdvancedWaiverPriorityUpdates(entries, userId);
    for (const update of updates) {
      const memberId = memberIdByUserId.get(update.userId);
      const original = entries.find((entry) => entry.userId === update.userId);
      if (!memberId || !original || original.priority === update.priority) continue;

      await this.db.$executeRaw`
        UPDATE WaiverPriority
        SET priority = ${update.priority}, updatedAt = ${new Date()}
        WHERE leagueId = ${leagueId} AND memberId = ${memberId}
      `;
    }
    await this.mirrorLeaguePriorityProjection(leagueId);
  }

  private async mapActionsToClaims(
    leagueId: string,
    actions: CanonicalWaiverActionRow[]
  ): Promise<WaiverClaim[]> {
    if (actions.length === 0) return [];

    const memberIds = Array.from(new Set(actions.map((action) => action.memberId)));
    const [members, priorityRows] = await Promise.all([
      this.db.leagueMember.findMany({
        where: { leagueId, id: { in: memberIds } },
        select: { id: true, userId: true },
      }),
      this.loadPriorityRows(this.db, leagueId),
    ]);
    const userIdByMemberId = new Map(members.map((member) => [member.id, member.userId]));
    const priorityByMemberId = new Map(priorityRows.map((row) => [row.memberId, row.priority]));

    return actions
      .map((action): WaiverClaim | null => {
        const details = parseActionDetails(action.details);
        const playerId = readOptionalString(details.playerId);
        const userId = userIdByMemberId.get(action.memberId);
        if (!playerId || !userId) return null;

        const priority = readOptionalNumber(details.priority) ?? 1;
        return {
          id: action.id,
          canonicalActionId: action.id,
          leagueId: action.leagueId,
          userId,
          teamId: action.memberId,
          playerId,
          priority,
          waiverPriority: priorityByMemberId.get(action.memberId) ?? priority,
          status: action.status,
          createdAt: normalizeDate(action.createdAt),
          processingAt: action.processingAt ? normalizeDate(action.processingAt) : undefined,
          ...(readOptionalString(details.dropPlayerId)
            ? { dropPlayerId: readOptionalString(details.dropPlayerId) }
            : {}),
          ...(typeof readOptionalNumber(details.bidAmount) === 'number'
            ? { bidAmount: readOptionalNumber(details.bidAmount) }
            : {}),
        };
      })
      .filter((claim): claim is WaiverClaim => claim !== null);
  }

  private async ensureLeaguePriorityRows(
    tx: PrismaWaiverStoreTransaction,
    leagueId: string,
    waiverSettings: WaiverSettings
  ): Promise<void> {
    const [members, existingRows] = await Promise.all([
      tx.leagueMember.findMany({
        where: { leagueId },
        orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
        select: { id: true },
      }),
      this.loadPriorityRows(tx, leagueId),
    ]);
    const draftPriorityMemberIds = await this.loadDraftPriorityMemberIds(tx, leagueId);
    const memberIds = new Set(members.map((member) => member.id));
    const orderedMembers =
      draftPriorityMemberIds.length > 0
        ? [
            ...draftPriorityMemberIds
              .filter((memberId) => memberIds.has(memberId))
              .map((memberId) => ({ id: memberId })),
            ...members.filter((member) => !draftPriorityMemberIds.includes(member.id)),
          ]
        : members;
    const existingMemberIds = new Set(existingRows.map((row) => row.memberId));
    const existingPriorities = existingRows.map((row) => row.priority);
    let nextPriority = existingPriorities.length > 0 ? Math.max(...existingPriorities) + 1 : 1;

    for (const member of orderedMembers) {
      if (existingMemberIds.has(member.id)) continue;

      await tx.$executeRaw`
        INSERT INTO WaiverPriority (id, leagueId, memberId, priority, remainingFAAB, pendingBidTotal, createdAt, updatedAt)
        VALUES (${randomUUID()}, ${leagueId}, ${member.id}, ${nextPriority}, ${
          waiverSettings.system === 'FAAB' ? (waiverSettings.faabBudget ?? 100) : null
        }, 0, ${new Date()}, ${new Date()})
      `;
      nextPriority += 1;
    }
  }

  private async reservePendingBid(
    tx: PrismaWaiverStoreTransaction,
    input: {
      leagueId: string;
      memberId: string;
      bidAmount: number;
      waiverSettings: WaiverSettings;
    }
  ): Promise<void> {
    const [priority] = await this.loadPriorityRows(tx, input.leagueId, input.memberId);
    const remainingFAAB =
      typeof priority?.remainingFAAB === 'number'
        ? priority.remainingFAAB
        : input.waiverSettings.faabBudget;
    if (typeof remainingFAAB !== 'number') {
      throw new WaiverClaimStoreError('FAAB_BALANCE_UNAVAILABLE', 'FAAB balance unavailable');
    }

    const pendingBidTotal = priority?.pendingBidTotal ?? 0;
    if (pendingBidTotal + input.bidAmount > remainingFAAB) {
      throw new WaiverClaimStoreError('INSUFFICIENT_FAAB', 'Insufficient FAAB remaining');
    }

    await tx.$executeRaw`
      UPDATE WaiverPriority
      SET pendingBidTotal = pendingBidTotal + ${input.bidAmount}, updatedAt = ${new Date()}
      WHERE leagueId = ${input.leagueId} AND memberId = ${input.memberId}
    `;
  }

  private async releasePendingBid(
    tx: Pick<PrismaWaiverStoreDb, '$executeRaw'>,
    claim: WaiverClaim
  ): Promise<void> {
    if (typeof claim.bidAmount !== 'number' || claim.bidAmount <= 0) return;

    await tx.$executeRaw`
      UPDATE WaiverPriority
      SET pendingBidTotal = CASE
        WHEN pendingBidTotal - ${claim.bidAmount} < 0 THEN 0
        ELSE pendingBidTotal - ${claim.bidAmount}
      END,
      updatedAt = ${new Date()}
      WHERE leagueId = ${claim.leagueId} AND memberId = ${claim.teamId}
    `;
  }

  private async loadDraftPriorityMemberIds(
    db: Pick<PrismaWaiverStoreDb, '$queryRaw'>,
    leagueId: string
  ): Promise<string[]> {
    const rows = (await db.$queryRaw`
      SELECT p.memberId, MAX(p.overall) AS finalPick
      FROM "Pick" p
      INNER JOIN "Draft" d ON d.id = p.draftId
      WHERE d.leagueId = ${leagueId}
      GROUP BY p.memberId
      ORDER BY finalPick DESC
    `) as DraftWaiverPrioritySeedRow[];

    return rows
      .filter((row) => typeof row.memberId === 'string' && Number.isFinite(Number(row.finalPick)))
      .map((row) => row.memberId);
  }

  private async loadPriorityRows(
    db: Pick<PrismaWaiverStoreDb, '$queryRaw'>,
    leagueId: string,
    memberId?: string
  ): Promise<WaiverPriorityRow[]> {
    if (memberId) {
      return (await db.$queryRaw`
        SELECT memberId, priority, remainingFAAB, pendingBidTotal
        FROM WaiverPriority
        WHERE leagueId = ${leagueId} AND memberId = ${memberId}
      `) as WaiverPriorityRow[];
    }

    return (await db.$queryRaw`
      SELECT memberId, priority, remainingFAAB, pendingBidTotal
      FROM WaiverPriority
      WHERE leagueId = ${leagueId}
      ORDER BY priority ASC
    `) as WaiverPriorityRow[];
  }

  private async mirrorPriorityProjection(leagueId: string, memberId: string): Promise<void> {
    const [member, priority] = await Promise.all([
      this.db.leagueMember.findFirst({
        where: { leagueId, id: memberId },
        select: { id: true, userId: true },
      }),
      this.loadPriorityRows(this.db, leagueId, memberId),
    ]);
    const row = priority[0];
    if (!member || !row) return;

    await this.writePriorityProjection({
      leagueId,
      userId: member.userId,
      memberId: member.id,
      priority: row.priority,
      remainingFAAB: row.remainingFAAB,
      pendingBidTotal: row.pendingBidTotal,
    });
  }

  private async mirrorLeaguePriorityProjection(leagueId: string): Promise<void> {
    const [members, rows] = await Promise.all([
      this.db.leagueMember.findMany({
        where: { leagueId },
        select: { id: true, userId: true },
      }),
      this.loadPriorityRows(this.db, leagueId),
    ]);
    const memberById = new Map(members.map((member) => [member.id, member]));

    await Promise.all(
      rows.map((row) => {
        const member = memberById.get(row.memberId);
        if (!member) return Promise.resolve();

        return this.writePriorityProjection({
          leagueId,
          userId: member.userId,
          memberId: member.id,
          priority: row.priority,
          remainingFAAB: row.remainingFAAB,
          pendingBidTotal: row.pendingBidTotal,
        });
      })
    );
  }

  private async writePriorityProjection(input: {
    leagueId: string;
    userId: string;
    memberId: string;
    priority: number;
    remainingFAAB?: number | null;
    pendingBidTotal?: number | null;
  }): Promise<void> {
    await this.firestore.doc(`leagues/${input.leagueId}/waiverPriorities/${input.userId}`).set(
      {
        leagueId: input.leagueId,
        userId: input.userId,
        teamId: input.memberId,
        priority: input.priority,
        pendingBidTotal: input.pendingBidTotal ?? 0,
        updatedAt: new Date(),
        ...(typeof input.remainingFAAB === 'number' ? { remainingFAAB: input.remainingFAAB } : {}),
      },
      { merge: true }
    );
  }

  private async writeSubmittedClaimProjection(claim: WaiverClaim): Promise<void> {
    await this.firestore
      .collection(`leagues/${claim.leagueId}/waivers`)
      .doc(claim.id)
      .set({
        leagueId: claim.leagueId,
        userId: claim.userId,
        teamId: claim.teamId,
        playerId: claim.playerId,
        priority: claim.priority,
        status: 'PENDING',
        canonicalActionId: claim.id,
        createdAt: claim.createdAt,
        ...(claim.processingAt ? { processingAt: claim.processingAt } : {}),
        ...(claim.dropPlayerId ? { dropPlayerId: claim.dropPlayerId } : {}),
        ...(typeof claim.bidAmount === 'number' ? { bidAmount: claim.bidAmount } : {}),
      });
  }

  private async updateClaimProjection(
    leagueId: string,
    claimId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.firestore.doc(`leagues/${leagueId}/waivers/${claimId}`).update(data);
    } catch (error) {
      logger.warn('Failed to update Firestore waiver compatibility projection', {
        leagueId,
        claimId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class FirestoreWaiverClaimStore implements ClaimStore {
  async loadWaiverSettings(leagueId: string): Promise<WaiverSettings> {
    const settingsSnap = await adminDb.doc(`leagues/${leagueId}/config/settings`).get();
    const rawSettings = settingsSnap.data()?.waiverSettings;
    return rawSettings && typeof rawSettings === 'object' ? (rawSettings as WaiverSettings) : {};
  }

  async loadPendingClaims(leagueId: string): Promise<WaiverClaim[]> {
    const pendingCol = adminDb
      .collection(`leagues/${leagueId}/waivers`)
      .where('status', '==', 'PENDING');
    const pending: WaiverClaim[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    const pageSize = 500;

    for (let i = 0; i < 10; i += 1) {
      let query: FirebaseFirestore.Query = pendingCol.orderBy('__name__').limit(pageSize);
      if (cursor) query = query.startAfter(cursor);

	      const snap = await query.get();
	      if (snap.empty) break;

	      for (const document of snap.docs) {
	        pending.push(toFirestoreWaiverClaim(document, leagueId));
	      }

	      if (snap.size < pageSize) break;
	      cursor = snap.docs[snap.docs.length - 1] ?? null;
	    }

	    return applyWaiverPriorities(pending, await loadWaiverPriorityByUserId(leagueId));
	  }

  async markSuccessful(input: {
    leagueId: string;
    claimId: string;
    claim: WaiverClaim;
  }): Promise<void> {
    await adminDb.doc(`leagues/${input.leagueId}/waivers/${input.claimId}`).update({
      status: 'SUCCESSFUL',
      processedAt: new Date(),
    });
  }

  async markFailed(input: {
    leagueId: string;
    claimId: string;
    claim: WaiverClaim;
    reason: string;
  }): Promise<void> {
    await adminDb.doc(`leagues/${input.leagueId}/waivers/${input.claimId}`).update({
      status: 'FAILED',
      processedAt: new Date(),
      reason: input.reason,
    });
  }

  async recordActivity(input: {
    leagueId: string;
    claim: WaiverClaim;
    type: 'waiver-submitted' | 'waiver-successful' | 'waiver-failed';
    reason?: string;
  }): Promise<void> {
    await adminDb
      .collection(`leagues/${input.leagueId}/activity`)
      .doc()
      .set({
        type: input.type,
        leagueId: input.leagueId,
        userId: input.claim.userId,
        teamId: input.claim.teamId,
        playerId: input.claim.playerId,
        claimId: input.claim.id,
        timestamp: new Date(),
        ...(input.claim.dropPlayerId ? { dropPlayerId: input.claim.dropPlayerId } : {}),
        ...(typeof input.claim.bidAmount === 'number' ? { bidAmount: input.claim.bidAmount } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      });
  }

  async decrementPendingBidTotal(claim: WaiverClaim, isFAAB: boolean): Promise<void> {
    if (!isFAAB || typeof claim.bidAmount !== 'number' || claim.bidAmount <= 0) return;

    const bid = claim.bidAmount;
    const bidCents = Math.round(bid * 100);
    const priorityRef = adminDb.doc(`leagues/${claim.leagueId}/waiverPriorities/${claim.userId}`);
    const prioritySnap = await priorityRef.get();
    const update = {
      pendingBidTotal: FieldValue.increment(-bid),
      pendingBidTotalCents: FieldValue.increment(-bidCents),
      updatedAt: new Date(),
    };

    if (prioritySnap.exists) {
      await priorityRef.update(update);
      return;
    }

    await priorityRef.set(
      {
        leagueId: claim.leagueId,
        userId: claim.userId,
        ...update,
      },
      { merge: true }
    );
  }

  async debitFaab(
    claim: WaiverClaim,
    waiverSettings: WaiverSettings
  ): Promise<{ ok: boolean; reason?: string }> {
    if (waiverSettings.system !== 'FAAB' || typeof claim.bidAmount !== 'number') {
      return { ok: true };
    }

    const priorityRef = adminDb.doc(`leagues/${claim.leagueId}/waiverPriorities/${claim.userId}`);

    try {
      return await adminDb.runTransaction(async (tx) => {
        const prioritySnap = await tx.get(priorityRef);
        const remainingFAAB = prioritySnap.exists
          ? (prioritySnap.data()?.remainingFAAB as number | undefined)
          : waiverSettings.faabBudget;

        if (typeof remainingFAAB !== 'number') {
          return { ok: false, reason: 'FAAB balance unavailable' };
        }

        if (claim.bidAmount! > remainingFAAB) {
          return { ok: false, reason: 'Insufficient FAAB' };
        }

        const nextRemainingFAAB = remainingFAAB - claim.bidAmount!;
        if (prioritySnap.exists) {
          tx.update(priorityRef, { remainingFAAB: nextRemainingFAAB, updatedAt: new Date() });
        } else {
          tx.set(priorityRef, {
            leagueId: claim.leagueId,
            userId: claim.userId,
            remainingFAAB: nextRemainingFAAB,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        return { ok: true };
      });
    } catch (error) {
      logger.warn('Failed to debit FAAB during waiver processing', {
        leagueId: claim.leagueId,
        userId: claim.userId,
        claimId: claim.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'FAAB balance unavailable' };
    }
  }

  async refundFaab(claim: WaiverClaim): Promise<void> {
    if (typeof claim.bidAmount !== 'number' || claim.bidAmount <= 0) return;

    await adminDb.doc(`leagues/${claim.leagueId}/waiverPriorities/${claim.userId}`).update({
      remainingFAAB: FieldValue.increment(claim.bidAmount),
      updatedAt: new Date(),
    });
  }

  async advancePriority(leagueId: string, userId: string): Promise<void> {
    const snap = await adminDb
      .collection(`leagues/${leagueId}/waiverPriorities`)
      .orderBy('priority', 'asc')
      .get();

    const entries = snap.docs
      .map((document) => {
        const data = document.data();
        return {
          userId: typeof data.userId === 'string' ? data.userId : document.id,
          priority: typeof data.priority === 'number' ? data.priority : Number.NaN,
          document,
        };
      })
      .filter((entry) => Number.isFinite(entry.priority));

    const updates = buildAdvancedWaiverPriorityUpdates(entries, userId);
    const updateByUserId = new Map(updates.map((entry) => [entry.userId, entry.priority]));
    const batch = adminDb.batch();
    let writeCount = 0;

    for (const entry of entries) {
      const nextPriority = updateByUserId.get(entry.userId);
      if (typeof nextPriority !== 'number' || nextPriority === entry.priority) continue;

      batch.update(entry.document.ref, { priority: nextPriority, updatedAt: new Date() });
      writeCount += 1;
    }

    if (writeCount > 0) {
      await batch.commit();
    }
  }
}
