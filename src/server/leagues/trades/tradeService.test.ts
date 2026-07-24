import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PrismaClient, TradeReviewMode } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const ids = {
  league: 'trade-test-league',
  season: 'trade-test-season',
  settings: 'trade-test-settings',
  commissionerUser: 'trade-test-user-commissioner',
  firstUser: 'trade-test-user-first',
  secondUser: 'trade-test-user-second',
  commissionerMember: 'trade-test-member-commissioner',
  firstMember: 'trade-test-member-first',
  secondMember: 'trade-test-member-second',
  firstPlayer: 'trade-test-player-first',
  firstPlayerAlias: 'trade-test-player-first-retired',
  secondPlayer: 'trade-test-player-second',
} as const;

const now = new Date('2026-07-21T10:00:00.000Z');

type TradeServiceModule = typeof import('./tradeService');
type TradeReadModelModule = typeof import('./tradeReadModel');

let databaseDirectory: string;
let prisma: PrismaClient;
let service: TradeServiceModule;
let readModel: TradeReadModelModule;

describe.sequential('league trade service transactions', () => {
  beforeAll(async () => {
    databaseDirectory = mkdtempSync('/tmp/statly-trade-service-');
    const databasePath = resolve(databaseDirectory, 'trade-service.db');
    const databaseUrl = `file:${databasePath}`;
    const prismaCli = resolve(process.cwd(), 'node_modules/.bin/prisma');

    const schemaSql = execFileSync(
      prismaCli,
      [
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      }
    );
    execFileSync('/usr/bin/sqlite3', [databasePath], { input: schemaSql, stdio: 'pipe' });

    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    await seedLeague();

    vi.resetModules();
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    service = await import('./tradeService');
    readModel = await import('./tradeReadModel');
  }, 60_000);

  afterAll(async () => {
    vi.doUnmock('@/lib/prisma');
    await prisma?.$disconnect();
    if (databaseDirectory) rmSync(databaseDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTradeState();
  });

  it('rejects a proposal that spoofs player ownership and rolls back its command', async () => {
    await expect(
      service.createLeagueTrade(
        ids.league,
        ids.firstUser,
        createInput({
          sendingPlayerIds: [ids.secondPlayer],
          receivingPlayerIds: [ids.firstPlayer],
        }),
        now
      )
    ).rejects.toMatchObject({ code: 'ROSTER_CHANGED', status: 409 });

    await expect(prisma.leagueTradeThread.count()).resolves.toBe(0);
    await expect(prisma.leagueTradeCommand.count()).resolves.toBe(0);
  });

  it('returns the original result for a repeated idempotency key', async () => {
    const input = createInput();

    const first = await service.createLeagueTrade(ids.league, ids.firstUser, input, now);
    const replay = await service.createLeagueTrade(ids.league, ids.firstUser, input, now);

    expect(replay).toEqual(first);
    await expect(prisma.leagueTradeThread.count()).resolves.toBe(1);
    await expect(prisma.leagueTradeOffer.count()).resolves.toBe(1);
    await expect(prisma.leagueTradeCommand.count()).resolves.toBe(1);
  });

  it('resolves a retired player alias before validating trade ownership', async () => {
    const created = await service.createLeagueTrade(
      ids.league,
      ids.firstUser,
      createInput({ sendingPlayerIds: [ids.firstPlayerAlias] }),
      now
    );

    await expect(
      prisma.leagueTradePlayer.findFirstOrThrow({ where: { offerId: created.offerId } })
    ).resolves.toMatchObject({ playerId: ids.firstPlayer });
  });

  it('persists immutable player identity snapshots with an offer', async () => {
    const created = await createTrade();
    await prisma.player.update({
      where: { id: ids.firstPlayer },
      data: { name: 'Renamed Player', club: 'ZZZ', position: 'DEF' },
    });

    const storedPlayer = await prisma.leagueTradePlayer.findFirstOrThrow({
      where: { offerId: created.offerId, playerId: ids.firstPlayer },
    });

    expect(storedPlayer).toMatchObject({
      playerNameSnapshot: 'First Player',
      playerClubSnapshot: 'AAA',
      playerPositionSnapshot: 'MID',
    });
    const sent = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.firstUser,
      view: 'sent',
    });
    expect(sent.trades[0]?.currentOffer.players).toContainEqual(
      expect.objectContaining({
        id: ids.firstPlayer,
        name: 'First Player',
        club: 'AAA',
        position: 'MID',
      })
    );

    await prisma.player.update({
      where: { id: ids.firstPlayer },
      data: { name: 'First Player', club: 'AAA', position: 'MID' },
    });
  });

  it('scopes the read model to the authenticated manager and rejects outsiders', async () => {
    await createTrade();

    const sent = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.firstUser,
      view: 'sent',
    });
    const inbox = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.secondUser,
      view: 'inbox',
    });

    expect(sent.trades).toHaveLength(1);
    expect(sent.trades[0]?.allowedActions).toEqual(['withdraw']);
    expect(inbox.trades).toHaveLength(1);
    expect(inbox.trades[0]?.allowedActions).toEqual(['accept', 'decline', 'counter']);
    expect(inbox.teams.find((team) => team.isViewer)?.memberId).toBe(ids.secondMember);
    expect(inbox.playerStats.context.basis).toBe('PER_GAME');
    expect(inbox.teams.some((team) => 'userId' in team)).toBe(false);
    await expect(
      readModel.loadAuthorizedLeagueTradeCentre({
        leagueId: ids.league,
        userId: 'not-a-league-member',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rejects malformed pagination cursors deliberately', async () => {
    await expect(
      readModel.loadAuthorizedLeagueTradeCentre({
        leagueId: ids.league,
        userId: ids.firstUser,
        cursor: 'not-a-valid-cursor',
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
  });

  it('conflicts when an idempotency key is reused with a changed payload', async () => {
    const input = createInput();
    await service.createLeagueTrade(ids.league, ids.firstUser, input, now);

    await expect(
      service.createLeagueTrade(
        ids.league,
        ids.firstUser,
        { ...input, message: 'A materially different offer' },
        now
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    await expect(prisma.leagueTradeThread.count()).resolves.toBe(1);
  });

  it('allows an even exchange when legacy rosters already exceed the configured limit', async () => {
    await prisma.leagueSettings.update({
      where: { id: ids.settings },
      data: { rosterSize: 0 },
    });

    const created = await createTrade();

    expect(created).toMatchObject({ status: 'OPEN', version: 0 });
  });

  it('accepts a NONE-review trade atomically and cannot apply the exchange twice', async () => {
    const created = await createTrade();
    const acceptInput = {
      action: 'accept' as const,
      expectedVersion: created.version,
      idempotencyKey: 'accept-none-0001',
    };

    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      acceptInput,
      now
    );
    const replay = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      acceptInput,
      now
    );

    expect(accepted).toMatchObject({ status: 'COMPLETED', version: 1 });
    expect(replay).toEqual(accepted);
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.secondMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.firstMember);
    await expect(legacyRoster(ids.firstMember)).resolves.toMatchObject({
      playerIds: [ids.secondPlayer],
      captainId: null,
    });
    await expect(legacyRoster(ids.secondMember)).resolves.toMatchObject({
      playerIds: [ids.firstPlayer],
      captainId: null,
    });

    await expect(
      service.executeLeagueTradeAction(
        ids.league,
        ids.secondUser,
        created.threadId,
        { ...acceptInput, idempotencyKey: 'accept-none-0002' },
        now
      )
    ).rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 });

    await expect(
      prisma.leagueTradeEvent.count({ where: { eventType: 'COMPLETED' } })
    ).resolves.toBe(1);
  });

  it('invalidates an accepted offer when ownership changed after proposal', async () => {
    const created = await createTrade();
    await prisma.leagueRosterPlayer.update({
      where: {
        leagueId_playerId: { leagueId: ids.league, playerId: ids.firstPlayer },
      },
      data: { memberId: ids.commissionerMember },
    });

    const result = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-stale-0001',
      },
      now
    );

    expect(result).toMatchObject({ status: 'INVALIDATED', version: 1 });
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.commissionerMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.secondMember);
  });

  it('creates an immutable next offer when the recipient counters', async () => {
    const created = await createTrade({ message: 'Opening offer' });

    const countered = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'counter',
        expectedVersion: created.version,
        idempotencyKey: 'counter-offer-0001',
        sendingPlayerIds: [ids.secondPlayer],
        receivingPlayerIds: [ids.firstPlayer],
        message: 'Counter offer',
      },
      now
    );
    const offers = await prisma.leagueTradeOffer.findMany({
      where: { threadId: created.threadId },
      orderBy: { sequence: 'asc' },
      include: { players: true },
    });

    expect(countered).toMatchObject({ status: 'OPEN', version: 1 });
    expect(countered.offerId).not.toBe(created.offerId);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      id: created.offerId,
      sequence: 1,
      status: 'SUPERSEDED',
      message: 'Opening offer',
    });
    expect(offers[1]).toMatchObject({
      id: countered.offerId,
      sequence: 2,
      status: 'PROPOSED',
      proposerMemberId: ids.secondMember,
      recipientMemberId: ids.firstMember,
      message: 'Counter offer',
    });
    expect(offers[0].players).toHaveLength(2);
    expect(offers[1].players).toHaveLength(2);

    const inbox = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.firstUser,
      view: 'inbox',
    });
    expect(inbox.trades[0]?.offerHistory).toMatchObject([
      { sequence: 2, status: 'PENDING', message: 'Counter offer' },
      { sequence: 1, status: 'COUNTERED', message: 'Opening offer' },
    ]);
    expect(inbox.trades[0]?.offerHistory.every((offer) => offer.players.length === 2)).toBe(true);
  });

  it('rejects client expiry overrides and caps server-owned expiry at the league deadline', async () => {
    const deadline = new Date(now.getTime() + 90 * 60 * 1000);
    await prisma.leagueSettings.update({
      where: { id: ids.settings },
      data: { tradeOfferExpiryHours: 2, tradeDeadline: deadline },
    });

    await expect(
      createTrade({ expiresAt: new Date(now.getTime() - 60_000).toISOString() })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const created = await createTrade();
    await expect(
      prisma.leagueTradeOffer.findUniqueOrThrow({ where: { id: created.offerId } })
    ).resolves.toMatchObject({ expiresAt: deadline });

    await prisma.leagueSettings.update({
      where: { id: ids.settings },
      data: { tradeDeadline: null },
    });
    const counteredAt = new Date(now.getTime() + 60_000);
    await expect(
      service.executeLeagueTradeAction(
        ids.league,
        ids.secondUser,
        created.threadId,
        {
          action: 'counter',
          expectedVersion: created.version,
          idempotencyKey: 'counter-expiry-invalid-0001',
          sendingPlayerIds: [ids.secondPlayer],
          receivingPlayerIds: [ids.firstPlayer],
          expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
        counteredAt
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const countered = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'counter',
        expectedVersion: created.version,
        idempotencyKey: 'counter-expiry-0001',
        sendingPlayerIds: [ids.secondPlayer],
        receivingPlayerIds: [ids.firstPlayer],
      },
      counteredAt
    );

    await expect(
      prisma.leagueTradeOffer.findUniqueOrThrow({ where: { id: countered.offerId } })
    ).resolves.toMatchObject({
      expiresAt: new Date(counteredAt.getTime() + 2 * 60 * 60 * 1000),
    });
  });

  it('invalidates an open trade instead of allowing a counter after a participant leaves', async () => {
    const created = await createTrade();
    await deactivateMember(ids.firstMember);

    const result = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'counter',
        expectedVersion: created.version,
        idempotencyKey: 'counter-inactive-0001',
        sendingPlayerIds: [ids.secondPlayer],
        receivingPlayerIds: [ids.firstPlayer],
      },
      now
    );

    expect(result).toMatchObject({ status: 'INVALIDATED', version: 1 });
    await expect(
      prisma.leagueTradeOffer.count({ where: { threadId: created.threadId } })
    ).resolves.toBe(1);
    await expect(
      prisma.leagueTradeEvent.findFirstOrThrow({
        where: { threadId: created.threadId, eventType: 'INVALIDATED' },
      })
    ).resolves.toMatchObject({ reasonCode: 'PARTICIPANT_INACTIVE' });
  });

  it('holds an ADMIN trade until a commissioner approves it', async () => {
    await setReviewMode('ADMIN');
    const created = await createTrade();

    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-admin-0001',
      },
      now
    );

    expect(accepted).toMatchObject({ status: 'PENDING_ADMIN_REVIEW', version: 1 });
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.firstMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.secondMember);

    const [participantReview, commissionerReview] = await Promise.all([
      readModel.loadAuthorizedLeagueTradeCentre({
        leagueId: ids.league,
        userId: ids.firstUser,
        view: 'review',
      }),
      readModel.loadAuthorizedLeagueTradeCentre({
        leagueId: ids.league,
        userId: ids.commissionerUser,
        view: 'review',
      }),
    ]);
    expect(participantReview.trades).toHaveLength(1);
    expect(participantReview.trades[0]?.allowedActions).toEqual([]);
    expect(participantReview.counts.review).toBe(1);
    expect(commissionerReview.trades).toHaveLength(1);
    expect(commissionerReview.trades[0]?.allowedActions).toEqual(['approve', 'reject']);

    const approved = await service.executeLeagueTradeAction(
      ids.league,
      ids.commissionerUser,
      created.threadId,
      {
        action: 'approve',
        expectedVersion: accepted.version,
        idempotencyKey: 'approve-admin-0001',
      },
      now
    );

    expect(approved).toMatchObject({ status: 'COMPLETED', version: 2 });
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.secondMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.firstMember);

    const participantHistory = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.firstUser,
      view: 'history',
    });
    expect(participantHistory.trades).toHaveLength(1);
    expect(participantHistory.trades[0]).toMatchObject({
      id: created.threadId,
      status: 'COMPLETED',
    });
    const commissionerHistory = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.commissionerUser,
      view: 'history',
    });
    expect(commissionerHistory.trades).toHaveLength(0);
  });

  it('surfaces a sanitized commissioner rejection reason in terminal audit history', async () => {
    await setReviewMode('ADMIN');
    const created = await createTrade();
    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-admin-reject-0001',
      },
      now
    );

    await service.executeLeagueTradeAction(
      ids.league,
      ids.commissionerUser,
      created.threadId,
      {
        action: 'reject',
        expectedVersion: accepted.version,
        idempotencyKey: 'reject-admin-0001',
        reason: '  Competitive balance\nrequires   review.  ',
      },
      now
    );

    const history = await readModel.loadAuthorizedLeagueTradeCentre({
      leagueId: ids.league,
      userId: ids.firstUser,
      view: 'history',
    });
    expect(history.trades).toHaveLength(1);
    expect(history.trades[0]).toMatchObject({
      status: 'COMMISSIONER_REJECTED',
      allowedActions: [],
    });
    expect(history.trades[0]?.events.find((event) => event.type === 'REJECTED')).toMatchObject({
      reasonCode: 'COMMISSIONER_REJECTED',
      reason: 'Competitive balance requires review.',
    });
  });

  it('invalidates an ADMIN trade when a participant leaves before commissioner approval', async () => {
    await setReviewMode('ADMIN');
    const created = await createTrade();
    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-admin-inactive-0001',
      },
      now
    );
    await deactivateMember(ids.firstMember);

    const approved = await service.executeLeagueTradeAction(
      ids.league,
      ids.commissionerUser,
      created.threadId,
      {
        action: 'approve',
        expectedVersion: accepted.version,
        idempotencyKey: 'approve-admin-inactive-0001',
      },
      now
    );

    expect(approved).toMatchObject({ status: 'INVALIDATED', version: 2 });
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.firstMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.secondMember);
  });

  it('resolves a VETO trade without moving players when its threshold is reached', async () => {
    await setReviewMode('VETO', 1);
    const created = await createTrade();
    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-veto-0001',
      },
      now
    );

    expect(accepted).toMatchObject({ status: 'PENDING_VETO_REVIEW', version: 1 });
    const vetoed = await service.executeLeagueTradeAction(
      ids.league,
      ids.commissionerUser,
      created.threadId,
      {
        action: 'veto',
        expectedVersion: accepted.version,
        idempotencyKey: 'cast-veto-0001',
      },
      new Date(now.getTime() + 60_000)
    );

    expect(vetoed).toMatchObject({ status: 'VETOED', version: 2 });
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.firstMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.secondMember);
    await expect(
      prisma.leagueTradeVeto.count({ where: { offerId: created.offerId } })
    ).resolves.toBe(1);
  });

  it('completes a VETO trade when its review window expires without enough vetoes', async () => {
    await setReviewMode('VETO', 3);
    const created = await createTrade();
    const accepted = await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-veto-window-0001',
      },
      now
    );

    expect(accepted).toMatchObject({ status: 'PENDING_VETO_REVIEW', version: 1 });
    await expect(
      service.processDueLeagueTrades(new Date(now.getTime() + 25 * 60 * 60 * 1000))
    ).resolves.toBe(1);
    await expect(ownerOf(ids.firstPlayer)).resolves.toBe(ids.secondMember);
    await expect(ownerOf(ids.secondPlayer)).resolves.toBe(ids.firstMember);
    await expect(
      prisma.leagueTradeThread.findUniqueOrThrow({ where: { id: created.threadId } })
    ).resolves.toMatchObject({ status: 'COMPLETED', version: 2 });
  });

  it('invalidates a due VETO trade when a participant leaves during review', async () => {
    await setReviewMode('VETO', 3);
    const created = await createTrade();
    await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-veto-inactive-0001',
      },
      now
    );
    await deactivateMember(ids.firstMember);

    await expect(
      service.processDueLeagueTrades(new Date(now.getTime() + 25 * 60 * 60 * 1000))
    ).resolves.toBe(1);
    await expect(
      prisma.leagueTradeThread.findUniqueOrThrow({ where: { id: created.threadId } })
    ).resolves.toMatchObject({ status: 'INVALIDATED', version: 2 });
    await expect(
      prisma.leagueTradeEvent.findFirstOrThrow({
        where: { threadId: created.threadId, eventType: 'INVALIDATED' },
      })
    ).resolves.toMatchObject({ reasonCode: 'PARTICIPANT_INACTIVE' });
  });

  it('terminally invalidates a due trade from a season that is no longer active', async () => {
    await setReviewMode('VETO', 3);
    const created = await createTrade();
    await service.executeLeagueTradeAction(
      ids.league,
      ids.secondUser,
      created.threadId,
      {
        action: 'accept',
        expectedVersion: created.version,
        idempotencyKey: 'accept-veto-rollover-0001',
      },
      now
    );
    await prisma.league.update({
      where: { id: ids.league },
      data: { activeSeasonId: null },
    });

    const dueAt = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await expect(service.processDueLeagueTrades(dueAt)).resolves.toBe(1);
    await expect(service.processDueLeagueTrades(dueAt)).resolves.toBe(0);
    await expect(
      prisma.leagueTradeThread.findUniqueOrThrow({ where: { id: created.threadId } })
    ).resolves.toMatchObject({ status: 'INVALIDATED', version: 2 });
    await expect(
      prisma.leagueTradeEvent.findFirstOrThrow({
        where: { threadId: created.threadId, eventType: 'INVALIDATED' },
      })
    ).resolves.toMatchObject({ reasonCode: 'SEASON_CLOSED' });
  });
});

async function seedLeague(): Promise<void> {
  await prisma.leagueSettings.create({
    data: {
      id: ids.settings,
      rosterSize: 4,
      benchSize: 2,
      maxTeams: 8,
      pickSeconds: 60,
      draftType: 'SNAKE',
      startAt: now,
      tradeLimit: 10,
      tradeReviewMode: 'NONE',
      tradeOfferExpiryHours: 72,
      tradeReviewHours: 24,
      tradeVetoThreshold: 3,
    },
  });
  await prisma.user.createMany({
    data: [
      user(ids.commissionerUser, 'commissioner'),
      user(ids.firstUser, 'first-manager'),
      user(ids.secondUser, 'second-manager'),
    ],
  });
  await prisma.league.create({
    data: {
      id: ids.league,
      name: 'Trade service test league',
      inviteCode: 'TRADETEST',
      ownerId: ids.commissionerUser,
      settingsId: ids.settings,
    },
  });
  await prisma.leagueSeason.create({
    data: { id: ids.season, leagueId: ids.league, label: '2026', year: 2026 },
  });
  await prisma.league.update({
    where: { id: ids.league },
    data: { activeSeasonId: ids.season },
  });
  await prisma.leagueMember.createMany({
    data: [
      member(ids.commissionerMember, ids.commissionerUser, 'Commissioner', 'OWNER'),
      member(ids.firstMember, ids.firstUser, 'First Team', 'MANAGER'),
      member(ids.secondMember, ids.secondUser, 'Second Team', 'MANAGER'),
    ],
  });
  await prisma.player.createMany({
    data: [
      { id: ids.firstPlayer, name: 'First Player', club: 'AAA', position: 'MID' },
      { id: ids.secondPlayer, name: 'Second Player', club: 'BBB', position: 'FWD' },
    ],
  });
  await prisma.playerExternalIdentity.create({
    data: {
      provider: 'statly-legacy',
      externalId: ids.firstPlayerAlias,
      playerId: ids.firstPlayer,
    },
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      {
        id: 'trade-test-roster-player-first',
        leagueId: ids.league,
        memberId: ids.firstMember,
        playerId: ids.firstPlayer,
      },
      {
        id: 'trade-test-roster-player-second',
        leagueId: ids.league,
        memberId: ids.secondMember,
        playerId: ids.secondPlayer,
      },
    ],
  });
  await prisma.leagueRoster.createMany({
    data: [
      {
        id: 'trade-test-legacy-roster-first',
        leagueId: ids.league,
        memberId: ids.firstMember,
        playerIds: JSON.stringify([ids.firstPlayer]),
        captainId: ids.firstPlayer,
      },
      {
        id: 'trade-test-legacy-roster-second',
        leagueId: ids.league,
        memberId: ids.secondMember,
        playerIds: JSON.stringify([ids.secondPlayer]),
        captainId: ids.secondPlayer,
      },
    ],
  });
}

async function resetTradeState(): Promise<void> {
  await prisma.leagueTradeCommand.deleteMany();
  await prisma.leagueTradeThread.deleteMany();
  await prisma.player.update({
    where: { id: ids.firstPlayer },
    data: { name: 'First Player', club: 'AAA', position: 'MID' },
  });
  await prisma.league.update({
    where: { id: ids.league },
    data: { activeSeasonId: ids.season },
  });
  await prisma.leagueMember.updateMany({
    where: { leagueId: ids.league },
    data: { isActive: true, status: 'ACTIVE' },
  });
  await prisma.leagueSettings.update({
    where: { id: ids.settings },
    data: {
      rosterSize: 4,
      tradeDeadline: null,
      tradeOfferExpiryHours: 72,
      tradeReviewHours: 24,
      tradeVetoThreshold: 3,
    },
  });
  await prisma.leagueRosterPlayer.update({
    where: { leagueId_playerId: { leagueId: ids.league, playerId: ids.firstPlayer } },
    data: { memberId: ids.firstMember, acquiredBy: 'DRAFT' },
  });
  await prisma.leagueRosterPlayer.update({
    where: { leagueId_playerId: { leagueId: ids.league, playerId: ids.secondPlayer } },
    data: { memberId: ids.secondMember, acquiredBy: 'DRAFT' },
  });
  await prisma.leagueRoster.update({
    where: { leagueId_memberId: { leagueId: ids.league, memberId: ids.firstMember } },
    data: { playerIds: JSON.stringify([ids.firstPlayer]), captainId: ids.firstPlayer },
  });
  await prisma.leagueRoster.update({
    where: { leagueId_memberId: { leagueId: ids.league, memberId: ids.secondMember } },
    data: { playerIds: JSON.stringify([ids.secondPlayer]), captainId: ids.secondPlayer },
  });
  await setReviewMode('NONE');
}

async function createTrade(
  overrides: Record<string, unknown> = {}
): Promise<Awaited<ReturnType<TradeServiceModule['createLeagueTrade']>>> {
  return service.createLeagueTrade(ids.league, ids.firstUser, createInput(overrides), now);
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    recipientMemberId: ids.secondMember,
    sendingPlayerIds: [ids.firstPlayer],
    receivingPlayerIds: [ids.secondPlayer],
    message: 'Opening offer',
    idempotencyKey: 'create-trade-0001',
    ...overrides,
  };
}

async function setReviewMode(mode: TradeReviewMode, vetoThreshold = 3): Promise<void> {
  await prisma.leagueSettings.update({
    where: { id: ids.settings },
    data: { tradeReviewMode: mode, tradeVetoThreshold: vetoThreshold },
  });
}

async function deactivateMember(memberId: string): Promise<void> {
  await prisma.leagueMember.update({
    where: { id: memberId },
    data: { isActive: false, status: 'INACTIVE' },
  });
}

async function ownerOf(playerId: string): Promise<string | undefined> {
  return (
    await prisma.leagueRosterPlayer.findUnique({
      where: { leagueId_playerId: { leagueId: ids.league, playerId } },
      select: { memberId: true },
    })
  )?.memberId;
}

async function legacyRoster(memberId: string) {
  const roster = await prisma.leagueRoster.findUniqueOrThrow({
    where: { leagueId_memberId: { leagueId: ids.league, memberId } },
    select: { playerIds: true, captainId: true },
  });
  return { ...roster, playerIds: JSON.parse(roster.playerIds) as string[] };
}

function user(id: string, name: string) {
  return {
    id,
    email: `${name}@trade-test.invalid`,
    passwordHash: 'not-used-in-tests',
    displayName: name,
  };
}

function member(id: string, userId: string, teamName: string, role: 'OWNER' | 'MANAGER') {
  return { id, leagueId: ids.league, userId, teamName, role };
}
