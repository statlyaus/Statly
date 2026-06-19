import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('draft command routes', () => {
  it.each([
    ['src/app/api/drafts/[id]/start/route.ts', 'startDraft'],
    ['src/app/api/drafts/[id]/pause/route.ts', 'pauseDraft'],
    ['src/app/api/drafts/[id]/resume/route.ts', 'resumeDraft'],
    ['src/app/api/drafts/[id]/auto-pick/route.ts', 'autoPick'],
  ])('%s delegates lifecycle mutation to DraftApplicationService', (path, method) => {
    const source = read(path);

    expect(source).toContain('draftApplicationService');
    expect(source).toContain(`.${method}(`);
    expect(source).not.toContain('getLiveDraftEngine');
    expect(source).not.toContain("from '@/services/liveDraftEngine'");
    expect(source).not.toContain('prisma.$transaction');
    expect(source).not.toContain('prisma.draft.update');
  });

  it('keeps manual picks on the shared application service command path', () => {
    const pickRoute = read('src/app/api/drafts/[id]/pick/route.ts');
    const pickCommand = read('src/server/draft/api/handlePickCommand.ts');

    expect(pickRoute).toContain('handlePickCommand');
    expect(pickRoute).not.toContain('getLiveDraftEngine');
    expect(pickRoute).not.toContain('prisma.$transaction');
    expect(pickCommand).toContain('draftApplicationService.makePick');
    expect(pickCommand).toContain('draftRealtimePublisher.publishCommandResult');
  });

  it('supports the client POST path used by DraftContext.makePick', () => {
    const draftContext = read('src/contexts/DraftContext.tsx');
    const picksRoute = read('src/app/api/drafts/[id]/picks/route.ts');

    expect(draftContext).toContain('drafts/${draftId}/picks');
    expect(picksRoute).toContain('export async function POST');
    expect(picksRoute).toContain('handlePickCommand');
  });

  it('returns draft state metadata with persisted picks for lightweight backfill', () => {
    const picksRoute = read('src/app/api/drafts/[id]/picks/route.ts');
    const draftContext = read('src/contexts/DraftContext.tsx');

    expect(picksRoute).toContain('draftState');
    expect(picksRoute).toContain('currentPick');
    expect(picksRoute).toContain('pickDeadlineAt');
    expect(draftContext).toContain('draftState');
    expect(draftContext).toContain('pickDeadlineAt');
  });

  it('uses the shared authenticated request helper for manual pick commands', () => {
    const pickCommand = read('src/server/draft/api/handlePickCommand.ts');

    expect(pickCommand).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(pickCommand).toContain('let userId = await getAuthenticatedUserId(request)');
    expect(pickCommand).not.toContain('getUserIdFromRequest');
  });

  it('does not block HTTP pick responses on realtime side effects', () => {
    const pickCommand = read('src/server/draft/api/handlePickCommand.ts');
    const autoPickRoute = read('src/app/api/drafts/[id]/auto-pick/route.ts');

    expect(pickCommand).toContain('void draftRealtimePublisher.publishCommandResult(result)');
    expect(pickCommand).not.toContain('await draftRealtimePublisher.publishCommandResult(result)');
    expect(autoPickRoute).toContain('void draftRealtimePublisher.publishCommandResult(result)');
    expect(autoPickRoute).not.toContain('await draftRealtimePublisher.publishCommandResult(result)');
  });

  it('supports the authenticated client POST path used by DraftContext.startDraft', () => {
    const draftContext = read('src/contexts/DraftContext.tsx');
    const startRoute = read('src/app/api/drafts/[id]/start/route.ts');

    expect(draftContext).toContain('startDraft');
    expect(draftContext).toContain('fetchApi(`drafts/${draftId}/start`');
    expect(startRoute).toContain('export async function POST');
    expect(startRoute).toContain('draftApplicationService.startDraft');
  });

  it('keeps HTTP actor checks in the service without breaking system draft jobs', () => {
    const service = read('src/server/draft/services/DraftApplicationService.ts');
    const worker = read('src/server/workers/enhancedDraftWorker.ts');

    expect(service).toContain('actorUserId?: string');
    expect(service).toContain('assertCanManageDraftCommand');
    expect(service).toContain('input.actorUserId');
    expect(worker).toContain('draftApplicationService.autoPick({ draftId })');
    expect(worker).toContain('draftApplicationService.startDraft({ draftId: scheduledDraft })');
  });

  it('advances the authoritative draft when the Socket.IO live timer expires', () => {
    const socketServer = read('src/server/socketioServer.ts');

    expect(socketServer).toContain('async function runAutoPickForExpiredTimer');
    expect(socketServer).toContain('draftApplicationService.autoPick');
    expect(socketServer).toContain('expectedSchedulingVersion: draft.schedulingVersion');
    expect(socketServer).toContain('requireExpired: true');
    expect(socketServer).toContain('draftRealtimePublisher.publishCommandResult(result)');
    expect(socketServer.indexOf('publishTimerExpired(draftId)')).toBeLessThan(
      socketServer.indexOf('runAutoPickForExpiredTimer(draftId)')
    );
  });
});
