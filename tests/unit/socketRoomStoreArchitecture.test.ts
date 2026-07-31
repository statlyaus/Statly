import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Socket.IO room state architecture', () => {
  it('keeps the shared room store as the only room state source', () => {
    const source = readSocketServer();

    expect(source).not.toContain('interface DraftRoom');
    expect(source).not.toContain('new Map<string, DraftRoom>()');
    expect(source).not.toContain('draftRooms.get(');
    expect(source).not.toContain('draftRooms.delete(');
    expect(source).toContain('draftRoomStore.removeParticipant(draftId, socket.id)');
  });

  it('reports authoritative room count and fails health when that read fails', () => {
    const source = readSocketServer();

    expect(source).toContain("app.get('/health', async");
    expect(source).toContain('await draftRoomStore.getRoomsCount()');
    expect(source).toContain("logger.error('Socket.IO health room-store check failed', error)");
    expect(source).toContain('res.status(503).json({');
    expect(source).toContain('draftRooms: null');
  });

  it('does not retain a per-process timer authority', () => {
    const source = readSocketServer();

    expect(source).not.toContain('roomTimers');
    expect(source).not.toContain('startDraftTimer');
    expect(source).toContain('Direct socket timers are disabled');
    expect(source).toContain('draftProjectionService.buildRoomSnapshot');
  });

  it('authorizes and snapshots before joining or replaying a draft room', () => {
    const source = readSocketServer();

    expect(source.indexOf('draftProjectionService.buildRoomSnapshot')).toBeLessThan(
      source.indexOf('draftRoomStore.initRoomIfMissing')
    );
    expect(source.indexOf("socket.emit('draft:snapshot', snapshot)")).toBeLessThan(
      source.indexOf("socket.emit('draft:backfill', deltas)")
    );
    expect(source).toContain('socket.data.draftId !== draftId');
  });

  it('replays persisted lifecycle events as revisioned canonical clock deltas', () => {
    const source = readSocketServer();

    expect(source).toContain('DraftClockPayloadSchema.safeParse');
    expect(source).toContain("buildLifecycleDelta('PAUSED')");
    expect(source).toContain("buildLifecycleDelta('LIVE')");
    expect(source).toContain('revision: clockResult.data.revision');
    expect(source).toContain(
      "pickDeadlineAt: clockResult.data.status === 'LIVE' ? clockResult.data.deadlineAt : null"
    );
  });
});

function readSocketServer(): string {
  return readFileSync(join(process.cwd(), 'src/server/socketioServer.ts'), 'utf8');
}
