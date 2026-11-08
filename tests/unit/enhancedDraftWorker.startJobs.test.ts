import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processors, draftQueue, draftRepository, draftApplicationService, logger } = vi.hoisted(
  () => ({
    processors: [] as Array<(job: unknown) => Promise<void>>,
    draftQueue: {
      remove: vi.fn(),
      add: vi.fn(),
    },
    draftRepository: {
      transaction: vi.fn(),
      getDraftAggregate: vi.fn(),
    },
    draftApplicationService: {
      openScheduledLobby: vi.fn(),
      startDraft: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  })
);

vi.mock('bullmq', () => ({
  Worker: class {
    on = vi.fn();

    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      processors.push(processor);
    }
  },
  QueueEvents: class {
    on = vi.fn();
  },
}));

vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('@/server/realtime/scalableConnection', () => ({
  getRedisConnection: vi.fn(),
  ScalableRedisConnection: {
    getInstance: () => ({
      getWorkerClient: vi.fn(),
      getQueueEventsClient: vi.fn(),
    }),
  },
}));

vi.mock('@/server/queue/draftQueue', () => ({
  draftQueue,
  getDraftStartJobId: (draftId: string) => `start-job:${draftId}`,
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/draft/services/DraftApplicationService', () => ({ draftApplicationService }));
vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {
    publishDraftState: vi.fn(),
    publishCommandResult: vi.fn(),
  },
}));
vi.mock('@/server/draft/services/DraftExpiryReconciler', () => ({
  draftExpiryReconciler: { reconcileAllLiveDrafts: vi.fn() },
}));

import { EnhancedDraftWorker } from '@/server/workers/enhancedDraftWorker';

function processJob(job: { id: string; name: string; data: Record<string, unknown> }) {
  new EnhancedDraftWorker('worker-test');
  const processor = processors.at(-1);
  if (!processor) throw new Error('Worker processor was not registered');
  return processor(job);
}

describe('EnhancedDraftWorker draft start jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({}));
    draftQueue.remove.mockResolvedValue(1);
  });

  it('opens the lobby of the job draft and schedules its start under that draft', async () => {
    const scheduledStartAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    draftApplicationService.openScheduledLobby.mockResolvedValue({
      draftId: 'draft-2026',
      data: { scheduledStartAt },
    });

    await processJob({
      id: 'lobby-1',
      name: 'start',
      data: {
        kind: 'draft:start-lobby',
        draftId: 'draft-2026',
        leagueId: 'league-1',
        pickClock: 90_000,
      },
    });

    expect(draftApplicationService.openScheduledLobby).toHaveBeenCalledWith({
      draftId: 'draft-2026',
      leagueId: 'league-1',
    });
    expect(draftQueue.remove).toHaveBeenCalledWith('start-job:draft-2026');
    expect(draftQueue.add).toHaveBeenCalledWith(
      'start-draft',
      { kind: 'draft:start', draftId: 'draft-2026', leagueId: 'league-1', pickClock: 90_000 },
      expect.objectContaining({ jobId: 'start-job:draft-2026' })
    );
  });

  it('starts the draft named by the job', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-2026',
      leagueId: 'league-1',
      status: 'SCHEDULED',
    });
    draftApplicationService.startDraft.mockResolvedValue({ draftId: 'draft-2026' });

    await processJob({
      id: 'start-1',
      name: 'start-draft',
      data: { kind: 'draft:start', draftId: 'draft-2026', leagueId: 'league-1', pickClock: 90_000 },
    });

    expect(draftRepository.getDraftAggregate).toHaveBeenCalledWith({}, 'draft-2026');
    expect(draftApplicationService.startDraft).toHaveBeenCalledWith({ draftId: 'draft-2026' });
  });

  it('refuses a start job whose draft belongs to another league', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-2026',
      leagueId: 'league-other',
      status: 'SCHEDULED',
    });

    await processJob({
      id: 'start-1',
      name: 'start-draft',
      data: { kind: 'draft:start', draftId: 'draft-2026', leagueId: 'league-1', pickClock: 90_000 },
    });

    expect(draftApplicationService.startDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['draft:start-lobby', 'start'],
    ['draft:start', 'start-draft'],
  ])('refuses a legacy %s job without a draft id', async (kind, name) => {
    await processJob({
      id: 'legacy-1',
      name,
      data: { kind, leagueId: 'league-1', pickClock: 90_000 },
    });

    expect(draftApplicationService.openScheduledLobby).not.toHaveBeenCalled();
    expect(draftApplicationService.startDraft).not.toHaveBeenCalled();
    expect(draftRepository.transaction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Refusing draft start job without a draft id', {
      jobId: 'legacy-1',
      kind,
      leagueId: 'league-1',
    });
  });
});
