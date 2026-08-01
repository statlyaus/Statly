import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ids = {
  draft: 'queue-pick-race-draft',
  league: 'queue-pick-race-league',
  settings: 'queue-pick-race-settings',
  ownerUser: 'queue-pick-race-owner-user',
  ownerMember: 'queue-pick-race-owner-member',
  opponentUser: 'queue-pick-race-opponent-user',
  opponentMember: 'queue-pick-race-opponent-member',
  selectedPlayer: 'queue-pick-race-selected-player',
  remainingPlayer: 'queue-pick-race-remaining-player',
} as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type InteractiveTransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>['resolve'];
  let rejectPromise!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function resolveExecutablePath(executable: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }

  throw new Error(`${executable} is required to run the queue/pick race test`);
}

function createRequestOrderedClient(
  client: PrismaClient,
  queueTransactionRequested: Deferred<void>,
  allowQueueTransactionToStart: Deferred<void>
): PrismaClient {
  let shouldOrderNextTransaction = true;
  const runTransaction = client.$transaction.bind(client);

  return new Proxy(client, {
    get(target, property) {
      if (property === '$transaction') {
        return async <T>(
          work: (tx: Prisma.TransactionClient) => Promise<T>,
          options?: InteractiveTransactionOptions
        ): Promise<T> => {
          if (shouldOrderNextTransaction) {
            shouldOrderNextTransaction = false;
            queueTransactionRequested.resolve(undefined);
            await allowQueueTransactionToStart.promise;
          }

          return runTransaction(work, options);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function seedDraft(client: PrismaClient): Promise<void> {
  const startedAt = new Date('2026-08-01T12:00:00.000Z');

  await client.user.createMany({
    data: [
      {
        id: ids.ownerUser,
        email: 'queue-pick-race-owner@example.test',
        passwordHash: 'test-only',
        displayName: 'Queue Race Owner',
      },
      {
        id: ids.opponentUser,
        email: 'queue-pick-race-opponent@example.test',
        passwordHash: 'test-only',
        displayName: 'Queue Race Opponent',
      },
    ],
  });
  await client.player.createMany({
    data: [
      {
        id: ids.selectedPlayer,
        name: 'Selected Player',
        club: 'Carlton',
        position: 'MID',
      },
      {
        id: ids.remainingPlayer,
        name: 'Remaining Player',
        club: 'Sydney',
        position: 'FWD',
      },
    ],
  });
  await client.leagueSettings.create({
    data: {
      id: ids.settings,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      startAt: startedAt,
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });
  await client.league.create({
    data: {
      id: ids.league,
      name: 'Queue Pick Race League',
      inviteCode: 'QUEUE-RACE',
      ownerId: ids.ownerUser,
      settingsId: ids.settings,
    },
  });
  await client.leagueMember.createMany({
    data: [
      {
        id: ids.ownerMember,
        leagueId: ids.league,
        userId: ids.ownerUser,
        role: 'OWNER',
        teamName: 'Queue Race Owners',
        draftSlot: 1,
      },
      {
        id: ids.opponentMember,
        leagueId: ids.league,
        userId: ids.opponentUser,
        role: 'MANAGER',
        teamName: 'Queue Race Opponents',
        draftSlot: 2,
      },
    ],
  });
  await client.draft.create({
    data: {
      id: ids.draft,
      leagueId: ids.league,
      status: 'LIVE',
      currentPick: 1,
      totalPicks: 2,
      round: 1,
      direction: 'FORWARD',
      lobbyStatus: 'LIVE',
      startedAt,
      pickStartedAt: startedAt,
      pickDeadlineAt: new Date(startedAt.getTime() + 120_000),
      clockDurationSeconds: 120,
    },
  });
  await client.draftOrder.createMany({
    data: [
      { draftId: ids.draft, memberId: ids.ownerMember, slot: 1 },
      { draftId: ids.draft, memberId: ids.opponentMember, slot: 2 },
    ],
  });
  await client.preDraftQueue.createMany({
    data: [ids.ownerMember, ids.opponentMember].map((memberId) => ({
      draftId: ids.draft,
      memberId,
      playerId: ids.selectedPlayer,
      rank: 1,
    })),
  });
}

describe.sequential('draft queue request ordering and accepted-pick convergence', () => {
  let databaseDirectory: string | undefined;
  let client: PrismaClient | undefined;
  let privateStateService: InstanceType<
    typeof import('@/server/draft/services/DraftPrivateStateService').DraftPrivateStateService
  >;
  let applicationService: InstanceType<
    typeof import('@/server/draft/services/DraftApplicationService').DraftApplicationService
  >;
  let queueTransactionRequested: Deferred<void>;
  let allowQueueTransactionToStart: Deferred<void>;

  beforeAll(async () => {
    databaseDirectory = mkdtempSync(join(tmpdir(), 'statly-draft-queue-race-'));
    const databasePath = resolve(databaseDirectory, 'queue-pick-race.db');
    const databaseUrl = `file:${databasePath}`;
    const schemaPath = resolve(databaseDirectory, 'schema.prisma');
    const prismaCli = resolve(process.cwd(), 'node_modules/.bin/prisma');

    copyFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), schemaPath);
    const schemaSql = execFileSync(
      prismaCli,
      ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'],
      {
        cwd: databaseDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
      }
    );
    execFileSync(resolveExecutablePath('sqlite3'), [databasePath], {
      cwd: databaseDirectory,
      input: schemaSql,
      stdio: 'pipe',
    });

    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$connect();
    await seedDraft(client);

    queueTransactionRequested = createDeferred<void>();
    allowQueueTransactionToStart = createDeferred<void>();
    // Prisma's SQLite client serializes competing interactive transactions. This barrier instead
    // orders concurrent service requests at the repository boundary without claiming DB overlap.
    const gatedClient = createRequestOrderedClient(
      client,
      queueTransactionRequested,
      allowQueueTransactionToStart
    );

    vi.resetModules();
    vi.doMock('@/lib/prisma', () => ({ prisma: gatedClient }));
    vi.doMock('@/lib/logger', () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock('@/server/rosters/RosterProjectionService', () => ({
      RosterProjectionService: class {
        async projectDraft(): Promise<void> {}
      },
    }));
    vi.doMock('@/server/leagues/membership', () => ({
      getDraftMembershipAccess: vi.fn(),
      isActivePrismaMembership: (member: { isActive: boolean; status: string }) =>
        member.isActive &&
        !['declined', 'inactive', 'removed'].includes(member.status.trim().toLowerCase()),
    }));

    const [{ DraftPrivateStateService }, { DraftApplicationService }] = await Promise.all([
      import('@/server/draft/services/DraftPrivateStateService'),
      import('@/server/draft/services/DraftApplicationService'),
    ]);
    privateStateService = new DraftPrivateStateService();
    applicationService = new DraftApplicationService({ projectDraft: vi.fn() } as never);
  }, 60_000);

  afterAll(async () => {
    allowQueueTransactionToStart?.resolve(undefined);
    vi.doUnmock('@/server/leagues/membership');
    vi.doUnmock('@/server/rosters/RosterProjectionService');
    vi.doUnmock('@/lib/logger');
    vi.doUnmock('@/lib/prisma');
    vi.resetModules();
    await client?.$disconnect();
    if (databaseDirectory?.startsWith(join(tmpdir(), 'statly-draft-queue-race-'))) {
      rmSync(databaseDirectory, { recursive: true, force: true });
    }
  });

  it('filters a picked player when its queue request starts first but persists after the pick', async () => {
    const queueReplacement = privateStateService.replacePreDraftQueue({
      draftId: ids.draft,
      actorUserId: ids.ownerUser,
      unresolvedPlayerPolicy: 'reject',
      queue: [
        { playerId: ids.selectedPlayer, rank: 1 },
        { playerId: ids.remainingPlayer, rank: 2 },
      ],
    });

    await queueTransactionRequested.promise;

    let acceptedPick: Awaited<ReturnType<typeof applicationService.makePick>> | undefined;
    try {
      acceptedPick = await applicationService.makePick({
        draftId: ids.draft,
        actorUserId: ids.ownerUser,
        playerId: ids.selectedPlayer,
      });
    } finally {
      allowQueueTransactionToStart.resolve(undefined);
    }
    const replacement = await queueReplacement;

    expect(acceptedPick?.data.pick.player.id).toBe(ids.selectedPlayer);
    expect(acceptedPick?.data.idempotent).not.toBe(true);
    expect(replacement.removedPlayerIds).toContain(ids.selectedPlayer);
    expect(replacement.queue.map((item) => item.playerId)).toEqual([ids.remainingPlayer]);

    const [draft, picks, queues] = await Promise.all([
      client!.draft.findUniqueOrThrow({ where: { id: ids.draft } }),
      client!.pick.findMany({ where: { draftId: ids.draft } }),
      client!.preDraftQueue.findMany({
        where: { draftId: ids.draft },
        orderBy: [{ memberId: 'asc' }, { rank: 'asc' }],
      }),
    ]);

    expect(draft).toMatchObject({ status: 'LIVE', currentPick: 2, schedulingVersion: 1 });
    expect(picks).toEqual([
      expect.objectContaining({
        draftId: ids.draft,
        memberId: ids.ownerMember,
        playerId: ids.selectedPlayer,
        overall: 1,
      }),
    ]);
    expect(queues).toEqual([
      expect.objectContaining({
        draftId: ids.draft,
        memberId: ids.ownerMember,
        playerId: ids.remainingPlayer,
        rank: 1,
      }),
    ]);
    expect(queues.some((item) => item.playerId === ids.selectedPlayer)).toBe(false);
  });
});
