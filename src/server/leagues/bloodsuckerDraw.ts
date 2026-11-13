import 'server-only';

import { randomInt } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { isActivePrismaMembership, leagueManagerUserIds } from './activeMembership';
import { readDraftStarted } from './draftStarted';
import { buildLeagueFormatAudit, normalizeLeagueFormat, resolveBloodsuckerMemberId } from './leagueFormat';
import { lockLeagueRow } from './leagueRowLock';

// The live Bloodsucker draw in the draft lobby (Bloodsucker 9/9, #1286; BR-04b, US-2 AC1b).
// The server draws and commits the winner and the audit (method and candidates) in one transaction
// before any client sees it. Clients only replay a reveal from the committed row, so a refresh shows
// the same winner and never draws again. A draw cannot be repeated: once a drawn Bloodsucker is set
// the only change is choosing a member in settings, which is audited with method CHOSEN.

/** How long every client's reveal runs, measured from the committed `drawnAt`. */
export const BLOODSUCKER_REVEAL_MS = 6000;

export const BLOODSUCKER_DRAWN = 'BLOODSUCKER_DRAWN';

export type BloodsuckerDrawErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_BLOODSUCKER_LEAGUE'
  | 'DRAFT_STRUCTURE_LOCKED'
  | 'BLOODSUCKER_ALREADY_SET'
  | 'BLOODSUCKER_ALREADY_DRAWN'
  | 'NOT_ENOUGH_MEMBERS';

export class BloodsuckerDrawError extends Error {
  constructor(
    public readonly code: BloodsuckerDrawErrorCode,
    message: string,
    public readonly status: 403 | 404 | 409
  ) {
    super(message);
    this.name = 'BloodsuckerDrawError';
  }
}

export interface DrawCandidate {
  memberId: string;
  teamName: string;
}

export interface BloodsuckerDraw {
  drawId: string;
  drawnAt: string;
  winnerMemberId: string;
  candidates: DrawCandidate[];
  revealMs: number;
}

export interface BloodsuckerLobbyState {
  leagueFormat: string;
  bloodsucker: DrawCandidate | null;
  /** How the current Bloodsucker was set, when the audit says. */
  method: 'DRAW' | 'CHOSEN' | null;
  draw: BloodsuckerDraw | null;
  canManage: boolean;
  /** Whether the draw button is offered, and why not when it is not. */
  canDraw: boolean;
  drawBlockedReason: string | null;
  serverNow: string;
}

type Client = Prisma.TransactionClient | typeof prisma;

function readDrawPayload(id: string, createdAt: Date, payload: unknown): BloodsuckerDraw | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.reason !== BLOODSUCKER_DRAWN || typeof row.winnerMemberId !== 'string') return null;
  const candidates = Array.isArray(row.candidates)
    ? row.candidates.flatMap((candidate) => {
        const entry = candidate as Record<string, unknown> | null;
        return entry && typeof entry.memberId === 'string'
          ? [{ memberId: entry.memberId, teamName: String(entry.teamName ?? '') }]
          : [];
      })
    : [];
  return {
    drawId: id,
    drawnAt: typeof row.drawnAt === 'string' ? row.drawnAt : createdAt.toISOString(),
    winnerMemberId: row.winnerMemberId,
    candidates,
    revealMs: BLOODSUCKER_REVEAL_MS,
  };
}

/** Every draw ever committed for the league, newest first. */
async function loadDraws(client: Client, leagueId: string): Promise<BloodsuckerDraw[]> {
  const rows = await client.leagueCompetitionAudit.findMany({
    where: {
      leagueId,
      eventType: 'LEAGUE_FORMAT_CHANGED',
      payloadJson: { path: ['reason'], equals: BLOODSUCKER_DRAWN },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, createdAt: true, payloadJson: true },
  });
  return rows.flatMap((row) => readDrawPayload(row.id, row.createdAt, row.payloadJson) ?? []);
}

async function loadLatestMethod(client: Client, leagueId: string, memberId: string) {
  const rows = await client.leagueCompetitionAudit.findMany({
    where: { leagueId, eventType: 'LEAGUE_FORMAT_CHANGED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { payloadJson: true },
  });
  for (const row of rows) {
    const payload = row.payloadJson as Record<string, unknown> | null;
    const after = payload?.after as Record<string, unknown> | undefined;
    if (after?.bloodsuckerMemberId !== memberId) continue;
    if (payload?.reason === BLOODSUCKER_DRAWN) return 'DRAW' as const;
    if (payload?.method === 'CHOSEN' || payload?.reason === 'SETTINGS_UPDATED') {
      return 'CHOSEN' as const;
    }
  }
  return null;
}

/**
 * Why a draw is refused, or null when it may run. A draw may run only in a Bloodsucker league
 * before the draft starts, with no Bloodsucker set, and when no earlier drawn winner is still in the
 * league (BR-07: a drawn Bloodsucker who left may be replaced by a new draw; otherwise no re-roll).
 */
function drawRefusal(input: {
  leagueFormat: string;
  draftStarted: boolean;
  bloodsuckerMemberId: string | null;
  activeMemberIds: readonly string[];
  draws: readonly BloodsuckerDraw[];
}): BloodsuckerDrawError | null {
  if (input.leagueFormat !== 'BLOODSUCKER') {
    return new BloodsuckerDrawError(
      'NOT_BLOODSUCKER_LEAGUE',
      'Only a Bloodsucker league draws a Bloodsucker.',
      409
    );
  }
  if (input.draftStarted) {
    return new BloodsuckerDrawError(
      'DRAFT_STRUCTURE_LOCKED',
      'Draft structure is locked because the draft has started.',
      409
    );
  }
  if (input.draws.some((draw) => input.activeMemberIds.includes(draw.winnerMemberId))) {
    return new BloodsuckerDrawError(
      'BLOODSUCKER_ALREADY_DRAWN',
      'The Bloodsucker has already been drawn. You can only choose a member in league settings.',
      409
    );
  }
  if (input.bloodsuckerMemberId) {
    return new BloodsuckerDrawError(
      'BLOODSUCKER_ALREADY_SET',
      'A Bloodsucker is already chosen. Change it in league settings.',
      409
    );
  }
  if (input.activeMemberIds.length < 2) {
    return new BloodsuckerDrawError(
      'NOT_ENOUGH_MEMBERS',
      'At least two members are needed to draw a Bloodsucker.',
      409
    );
  }
  return null;
}

async function loadLeague(client: Client, leagueId: string) {
  const league = await client.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      settings: { select: { id: true, leagueFormat: true, bloodsuckerMemberId: true } },
      members: {
        select: {
          id: true,
          userId: true,
          teamName: true,
          isCoCommissioner: true,
          isActive: true,
          status: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!league?.settings) throw new BloodsuckerDrawError('NOT_FOUND', 'League not found.', 404);
  const active = league.members.filter(isActivePrismaMembership);
  return { league, settings: league.settings, active };
}

/** The lobby's view: the committed draw (if any), the current Bloodsucker and the draw button. */
export async function loadBloodsuckerLobbyState(input: {
  leagueId: string;
  userId: string;
  now?: Date;
}): Promise<BloodsuckerLobbyState> {
  const now = input.now ?? new Date();
  const { league, settings, active } = await loadLeague(prisma, input.leagueId);
  if (!active.some((member) => member.userId === input.userId)) {
    throw new BloodsuckerDrawError('FORBIDDEN', 'You are not a member of this league.', 403);
  }
  const activeIds = active.map((member) => member.id);
  const bloodsuckerId = resolveBloodsuckerMemberId(settings, activeIds);
  const [draws, draftStarted, method] = await Promise.all([
    loadDraws(prisma, input.leagueId),
    readDraftStarted(prisma, input.leagueId),
    bloodsuckerId ? loadLatestMethod(prisma, input.leagueId, bloodsuckerId) : null,
  ]);
  const canManage = leagueManagerUserIds({ ownerId: league.ownerId, members: active }).includes(
    input.userId
  );
  const refusal = drawRefusal({
    leagueFormat: normalizeLeagueFormat(settings.leagueFormat),
    draftStarted,
    bloodsuckerMemberId: bloodsuckerId,
    activeMemberIds: activeIds,
    draws,
  });
  const bloodsucker = active.find((member) => member.id === bloodsuckerId);
  return {
    leagueFormat: normalizeLeagueFormat(settings.leagueFormat),
    bloodsucker: bloodsucker ? { memberId: bloodsucker.id, teamName: bloodsucker.teamName } : null,
    method,
    draw: draws[0] ?? null,
    canManage,
    canDraw: canManage && refusal === null,
    drawBlockedReason: canManage ? (refusal?.message ?? null) : null,
    serverNow: now.toISOString(),
  };
}

/**
 * `POST /api/leagues/[id]/bloodsucker/draw`: a commissioner draws the Bloodsucker at random from the
 * active members. The winner, the candidates and the method are committed before the response.
 */
export async function drawBloodsucker(input: {
  leagueId: string;
  userId: string;
  now?: Date;
  /** Injected in tests; defaults to a cryptographic draw. */
  pickIndex?: (count: number) => number;
}): Promise<BloodsuckerLobbyState> {
  const now = input.now ?? new Date();
  const pickIndex = input.pickIndex ?? ((count: number) => randomInt(count));

  await prisma.$transaction(async (tx) => {
    await lockLeagueRow(tx, input.leagueId);
    const { league, settings, active } = await loadLeague(tx, input.leagueId);
    const actor = active.find((member) => member.userId === input.userId);
    if (
      !actor ||
      !leagueManagerUserIds({ ownerId: league.ownerId, members: active }).includes(input.userId)
    ) {
      throw new BloodsuckerDrawError(
        'FORBIDDEN',
        'Only the commissioner can draw the Bloodsucker.',
        403
      );
    }
    const activeIds = active.map((member) => member.id);
    const bloodsuckerId = resolveBloodsuckerMemberId(settings, activeIds);
    const refusal = drawRefusal({
      leagueFormat: normalizeLeagueFormat(settings.leagueFormat),
      draftStarted: await readDraftStarted(tx, input.leagueId),
      bloodsuckerMemberId: bloodsuckerId,
      activeMemberIds: activeIds,
      draws: await loadDraws(tx, input.leagueId),
    });
    if (refusal) throw refusal;

    const candidates = active.map((member) => ({
      memberId: member.id,
      teamName: member.teamName,
    }));
    const winner = candidates[pickIndex(candidates.length)];
    if (!winner) throw new Error('Bloodsucker draw picked no candidate');

    await tx.leagueSettings.update({
      where: { id: settings.id },
      data: { bloodsuckerMemberId: winner.memberId },
    });
    const audit = buildLeagueFormatAudit({
      leagueId: input.leagueId,
      actorMemberId: actor.id,
      before: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: settings.bloodsuckerMemberId },
      after: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: winner.memberId },
      reason: BLOODSUCKER_DRAWN,
    });
    await tx.leagueCompetitionAudit.create({
      data: {
        ...audit,
        payloadJson: {
          ...(audit.payloadJson as Record<string, Prisma.InputJsonValue>),
          method: 'DRAW',
          randomSource: 'crypto.randomInt',
          drawnAt: now.toISOString(),
          winnerMemberId: winner.memberId,
          candidates,
        },
      },
    });
  });

  return loadBloodsuckerLobbyState({ leagueId: input.leagueId, userId: input.userId, now });
}
