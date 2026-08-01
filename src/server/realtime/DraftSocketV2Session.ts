import { logger } from '@/lib/logger';
import { incCounter, METRICS, observeHistogram } from '@/server/metrics';
import {
  DraftReadAccessError,
  draftAuthorizedReadService,
} from '@/server/draft/services/DraftAuthorizedReadService';
import {
  MAX_DRAFT_REPLAY_LIMIT,
  draftRealtimeReplayService,
} from '@/server/draft/services/DraftRealtimeReplayService';
import { draftRoomStore } from '@/server/roomStore';
import {
  DraftRealtimeJoinAckSchema,
  DraftRealtimeSnapshotV2Schema,
  type DraftRealtimeJoinAck,
  type DraftRealtimeJoinV2Request,
  type DraftRealtimeLeaveV2Request,
  type DraftRealtimeReplayV2,
  type DraftRealtimeSnapshotV2,
} from '@/services/realtime/draftRealtimeV2';

type Awaitable<T> = T | Promise<T>;

export type DraftSocketV2Transport = {
  id: string;
  connected: boolean;
  data: Record<string, unknown>;
  join: (room: string) => Awaitable<void>;
  leave: (room: string) => Awaitable<void>;
  disconnect: (close?: boolean) => unknown;
};

type AuthorizedReads = Pick<
  typeof draftAuthorizedReadService,
  'authorizeMember' | 'buildRoomSnapshot'
>;
type ReplayReads = Pick<typeof draftRealtimeReplayService, 'replayForMember'>;
type RoomStore = Pick<
  typeof draftRoomStore,
  | 'initRoomIfMissing'
  | 'addParticipantIfUnderLimit'
  | 'setParticipantData'
  | 'getRoom'
  | 'saveRoom'
  | 'removeParticipant'
>;

export type DraftSocketV2ActiveSubscription = {
  draftId: string;
  leagueId: string;
  generation: number;
};

export type DraftSocketV2SessionDependencies = {
  socket: DraftSocketV2Transport;
  authenticatedUserId: string;
  authorizedReads?: AuthorizedReads;
  replayReads?: ReplayReads;
  rooms?: RoomStore;
  now?: () => Date;
  replayLimit?: number;
  maxBaselineAttempts?: number;
};

type JoinAcknowledge = (acknowledgement: DraftRealtimeJoinAck) => void;

class SupersededJoinError extends Error {}
class RoomFullError extends Error {}
class DraftNotFoundError extends Error {}
class SyncUnavailableError extends Error {}
class UnsafeSubscriptionCleanupError extends Error {}

export class DraftSocketV2Session {
  private readonly socket: DraftSocketV2Transport;
  private readonly authenticatedUserId: string;
  private readonly authorizedReads: AuthorizedReads;
  private readonly replayReads: ReplayReads;
  private readonly rooms: RoomStore;
  private readonly now: () => Date;
  private readonly replayLimit: number;
  private readonly maxBaselineAttempts: number;
  private latestEpoch = 0;
  private latestRequestedSubscription: { draftId: string; generation: number } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private active: DraftSocketV2ActiveSubscription | null = null;
  private closed = false;

  constructor(dependencies: DraftSocketV2SessionDependencies) {
    this.socket = dependencies.socket;
    this.authenticatedUserId = dependencies.authenticatedUserId;
    this.authorizedReads = dependencies.authorizedReads ?? draftAuthorizedReadService;
    this.replayReads = dependencies.replayReads ?? draftRealtimeReplayService;
    this.rooms = dependencies.rooms ?? draftRoomStore;
    this.now = dependencies.now ?? (() => new Date());
    this.replayLimit = dependencies.replayLimit ?? MAX_DRAFT_REPLAY_LIMIT;
    this.maxBaselineAttempts = dependencies.maxBaselineAttempts ?? 3;
  }

  join(request: DraftRealtimeJoinV2Request, acknowledge: JoinAcknowledge): Promise<void> {
    this.latestRequestedSubscription = {
      draftId: request.draftId,
      generation: request.generation,
    };
    const epoch = ++this.latestEpoch;
    const work = this.queue.then(() => this.runJoin(epoch, request, acknowledge));
    this.queue = work.catch(() => undefined);
    return work;
  }

  leave(request: DraftRealtimeLeaveV2Request): Promise<void> {
    if (
      this.latestRequestedSubscription?.draftId !== request.draftId ||
      this.latestRequestedSubscription.generation !== request.generation
    ) {
      return Promise.resolve();
    }
    this.latestRequestedSubscription = null;
    ++this.latestEpoch;
    const work = this.queue.then(async () => {
      const active = this.active;
      if (!active) return;
      await this.releaseActiveSubscription(active, 'leave', false);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  abandon(): Promise<void> {
    this.latestRequestedSubscription = null;
    ++this.latestEpoch;
    const work = this.queue.then(async () => {
      const active = this.active;
      if (!active) return;
      await this.releaseActiveSubscription(active, 'abandon', true);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  disconnect(): Promise<void> {
    this.closed = true;
    this.latestRequestedSubscription = null;
    ++this.latestEpoch;
    const work = this.queue.then(async () => {
      const active = this.active;
      if (!active) return;
      await this.releaseActiveSubscription(active, 'disconnect', false);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  getActive(): DraftSocketV2ActiveSubscription | null {
    return this.active ? { ...this.active } : null;
  }

  private async runJoin(
    epoch: number,
    request: DraftRealtimeJoinV2Request,
    acknowledge: JoinAcknowledge
  ): Promise<void> {
    const previous = this.active;
    let targetReserved = false;
    let committed = false;
    let replied = false;

    const reply = (value: DraftRealtimeJoinAck): void => {
      if (replied) return;
      replied = true;
      try {
        const parsed = DraftRealtimeJoinAckSchema.parse(value);
        incCounter(METRICS.draftRealtimeV2Joins, 1, {
          outcome: parsed.ok ? 'success' : parsed.code.toLowerCase(),
        });
        acknowledge(parsed);
      } catch (error) {
        logger.warn('Draft v2 acknowledgement failed', {
          socketId: this.socket.id,
          draftId: request.draftId,
          generation: request.generation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    try {
      await this.awaitCurrent(
        epoch,
        this.authorizedReads.authorizeMember(request.draftId, this.authenticatedUserId)
      );
      const room = await this.awaitCurrent(epoch, this.rooms.initRoomIfMissing(request.draftId));
      const reservation = await this.awaitCurrent(
        epoch,
        this.rooms.addParticipantIfUnderLimit(request.draftId, this.socket.id, room.maxParticipants)
      );
      if (!reservation.accepted) throw new RoomFullError();
      targetReserved = true;

      await this.awaitCurrent(epoch, Promise.resolve(this.socket.join(`draft:${request.draftId}`)));

      const baseline = await this.buildCompleteBaseline(epoch, request.draftId);
      const participant = baseline.snapshot.state.participants.find(
        (candidate) => candidate.userId === this.authenticatedUserId
      );
      await this.awaitCurrent(
        epoch,
        this.rooms.setParticipantData(request.draftId, this.socket.id, {
          userId: this.authenticatedUserId,
          memberId: participant?.id,
          displayName: participant?.displayName,
          socketId: this.socket.id,
          joinedAt: this.now().toISOString(),
          realtimeProtocol: 2,
          generation: request.generation,
        })
      );
      const latestRoom = await this.awaitCurrent(epoch, this.rooms.getRoom(request.draftId));
      if (!latestRoom) throw new SyncUnavailableError();
      await this.awaitCurrent(
        epoch,
        this.rooms.saveRoom({ ...latestRoom, lastActivity: this.now().toISOString() })
      );

      const nextActive: DraftSocketV2ActiveSubscription = {
        draftId: request.draftId,
        leagueId: baseline.snapshot.leagueId,
        generation: request.generation,
      };

      if (previous && previous.draftId !== nextActive.draftId) {
        try {
          await this.cleanupSubscription(previous.draftId);
        } catch (error) {
          logger.error('Failed to clean up superseded draft v2 subscription', {
            socketId: this.socket.id,
            draftId: previous.draftId,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.forceDisconnect([previous.draftId, nextActive.draftId]);
          throw new UnsafeSubscriptionCleanupError();
        }
        this.active = null;
        this.clearSocketData(previous);
      }

      this.assertCurrent(epoch);
      this.active = nextActive;
      this.socket.data.draftId = nextActive.draftId;
      this.socket.data.draftRealtimeProtocol = 2;
      this.socket.data.draftRealtimeGeneration = nextActive.generation;
      this.socket.data.joinedAt = this.now();
      committed = true;

      reply({
        ok: true,
        draftId: nextActive.draftId,
        leagueId: nextActive.leagueId,
        protocol: 2,
        generation: nextActive.generation,
        snapshot: baseline.snapshot,
        replay: baseline.replay,
      });
    } catch (error) {
      if (
        previous?.draftId === request.draftId &&
        (error instanceof DraftReadAccessError || error instanceof DraftNotFoundError)
      ) {
        this.active = null;
        this.clearSocketData(previous);
        try {
          await this.cleanupSubscription(previous.draftId);
        } catch (cleanupError) {
          logger.error('Failed to remove revoked draft v2 subscription', {
            socketId: this.socket.id,
            draftId: previous.draftId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
          await this.forceDisconnect([previous.draftId]);
        }
      }

      if (targetReserved && !committed && previous?.draftId !== request.draftId) {
        try {
          await this.cleanupSubscription(request.draftId);
        } catch (cleanupError) {
          logger.error('Failed to roll back draft v2 join', {
            socketId: this.socket.id,
            draftId: request.draftId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
          await this.forceDisconnect([previous?.draftId, request.draftId]);
        }
      }

      const failure = this.mapFailure(error, request);
      reply(failure);
    }
  }

  private async buildCompleteBaseline(
    epoch: number,
    draftId: string
  ): Promise<{ snapshot: DraftRealtimeSnapshotV2; replay: DraftRealtimeReplayV2 }> {
    for (let attempt = 0; attempt < this.maxBaselineAttempts; attempt += 1) {
      const snapshot = await this.awaitCurrent(
        epoch,
        this.authorizedReads.buildRoomSnapshot(draftId, this.authenticatedUserId)
      );
      if (!snapshot) throw new DraftNotFoundError();
      const v2Snapshot = DraftRealtimeSnapshotV2Schema.safeParse({
        ...snapshot,
        schemaVersion: 2,
      });
      if (!v2Snapshot.success) continue;

      const replay = await this.awaitCurrent(
        epoch,
        this.replayReads.replayForMember({
          draftId,
          authenticatedUserId: this.authenticatedUserId,
          afterSequence: v2Snapshot.data.throughSequence,
          limit: this.replayLimit,
        })
      );
      if (replay.status === 'not-found') throw new DraftNotFoundError();
      if (
        replay.status !== 'ready' ||
        replay.hasMore ||
        replay.draftId !== draftId ||
        replay.leagueId !== v2Snapshot.data.leagueId ||
        replay.afterSequence !== v2Snapshot.data.throughSequence ||
        replay.nextAfterSequence !== replay.throughSequence
      ) {
        continue;
      }

      observeHistogram('draft_realtime_v2_baseline_attempts', attempt + 1);
      observeHistogram('draft_realtime_v2_replay_events', replay.events.length);
      return {
        snapshot: v2Snapshot.data,
        replay: {
          afterSequence: replay.afterSequence,
          throughSequence: replay.throughSequence,
          events: replay.events,
        },
      };
    }

    observeHistogram('draft_realtime_v2_baseline_attempts', this.maxBaselineAttempts);
    throw new SyncUnavailableError();
  }

  private async awaitCurrent<T>(epoch: number, promise: Promise<T>): Promise<T> {
    const value = await promise;
    this.assertCurrent(epoch);
    return value;
  }

  private assertCurrent(epoch: number): void {
    if (this.closed || !this.socket.connected || epoch !== this.latestEpoch) {
      throw new SupersededJoinError();
    }
  }

  private async cleanupSubscription(draftId: string): Promise<void> {
    const results = await Promise.allSettled([
      Promise.resolve(this.socket.leave(`draft:${draftId}`)),
      this.rooms.removeParticipant(draftId, this.socket.id),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private async releaseActiveSubscription(
    active: DraftSocketV2ActiveSubscription,
    operation: 'leave' | 'abandon' | 'disconnect',
    propagateFailure: boolean
  ): Promise<void> {
    try {
      await this.cleanupSubscription(active.draftId);
    } catch (error) {
      logger.error('Failed to clean up active draft v2 subscription', {
        socketId: this.socket.id,
        draftId: active.draftId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.forceDisconnect([active.draftId]);
      if (propagateFailure) {
        throw new UnsafeSubscriptionCleanupError();
      }
      return;
    }

    if (this.active?.draftId === active.draftId && this.active.generation === active.generation) {
      this.active = null;
    }
    this.clearSocketData(active);
  }

  private async forceDisconnect(draftIds: Array<string | undefined>): Promise<void> {
    this.closed = true;
    ++this.latestEpoch;
    this.active = null;
    delete this.socket.data.draftId;
    delete this.socket.data.draftRealtimeProtocol;
    delete this.socket.data.draftRealtimeGeneration;
    delete this.socket.data.joinedAt;

    const uniqueDraftIds = [
      ...new Set(draftIds.filter((value): value is string => Boolean(value))),
    ];
    await Promise.allSettled(
      uniqueDraftIds.flatMap((draftId) => [
        Promise.resolve(this.socket.leave(`draft:${draftId}`)),
        this.rooms.removeParticipant(draftId, this.socket.id),
      ])
    );
    try {
      this.socket.disconnect(true);
    } catch (error) {
      logger.warn('Failed to force-close unsafe draft v2 socket', {
        socketId: this.socket.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearSocketData(active: DraftSocketV2ActiveSubscription): void {
    if (
      this.socket.data.draftId !== active.draftId ||
      this.socket.data.draftRealtimeGeneration !== active.generation
    ) {
      return;
    }
    delete this.socket.data.draftId;
    delete this.socket.data.draftRealtimeProtocol;
    delete this.socket.data.draftRealtimeGeneration;
    delete this.socket.data.joinedAt;
  }

  private mapFailure(error: unknown, request: DraftRealtimeJoinV2Request): DraftRealtimeJoinAck {
    const base = { ok: false as const, draftId: request.draftId, generation: request.generation };
    if (error instanceof SupersededJoinError) {
      return { ...base, code: 'SUPERSEDED', message: 'Draft join was superseded', retryable: true };
    }
    if (error instanceof DraftReadAccessError) {
      return { ...base, code: 'FORBIDDEN', message: 'Draft access denied', retryable: false };
    }
    if (error instanceof RoomFullError) {
      return { ...base, code: 'ROOM_FULL', message: 'Draft room is full', retryable: true };
    }
    if (error instanceof DraftNotFoundError) {
      return { ...base, code: 'NOT_FOUND', message: 'Draft not found', retryable: false };
    }
    if (error instanceof SyncUnavailableError) {
      return {
        ...base,
        code: 'SYNC_UNAVAILABLE',
        message: 'Draft baseline is temporarily unavailable',
        retryable: true,
      };
    }
    if (error instanceof UnsafeSubscriptionCleanupError) {
      return {
        ...base,
        code: 'INTERNAL_ERROR',
        message: 'Draft subscription could not be switched safely',
        retryable: true,
      };
    }
    logger.error('Draft v2 join failed', {
      socketId: this.socket.id,
      draftId: request.draftId,
      generation: request.generation,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      code: 'INTERNAL_ERROR',
      message: 'Failed to join draft',
      retryable: true,
    };
  }
}
