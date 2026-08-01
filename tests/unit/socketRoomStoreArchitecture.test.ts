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
    expect(source).toContain('draftAuthorizedReadService.buildRoomSnapshot');
  });

  it('authorizes before reservation, then subscribes before taking the canonical baseline', () => {
    const source = readSocketServer();
    const protocolNegotiation = source.indexOf(
      'selectDraftRealtimeProtocol(realtimeProtocols, [2, 1])'
    );
    const authorizationRead = source.indexOf(
      'const authorizationSnapshot = await draftAuthorizedReadService.buildRoomSnapshot'
    );
    const v2Abandonment = source.indexOf('await draftSocketV2Session.abandon()');
    const roomReservation = source.indexOf('draftRoomStore.initRoomIfMissing');
    const primaryJoin = source.indexOf('await socket.join(draftId)');
    const aliasJoin = source.indexOf('await socket.join(`draft:${draftId}`)');
    const baselineRead = source.indexOf(
      'const snapshot = await draftAuthorizedReadService.buildRoomSnapshot'
    );
    const snapshotEmit = source.indexOf("socket.emit('draft:snapshot', snapshot)");
    const backfillRead = source.indexOf('const deltas = await getDeltasSince');

    expect(protocolNegotiation).toBeLessThan(authorizationRead);
    expect(v2Abandonment).toBeLessThan(authorizationRead);
    expect(authorizationRead).toBeLessThan(roomReservation);
    expect(roomReservation).toBeLessThan(primaryJoin);
    expect(primaryJoin).toBeLessThan(aliasJoin);
    expect(aliasJoin).toBeLessThan(baselineRead);
    expect(baselineRead).toBeLessThan(snapshotEmit);
    expect(snapshotEmit).toBeLessThan(backfillRead);
    expect(source).toContain('socket.data.draftId !== draftId');
    expect(source.indexOf("socket.emit('draft:backfill', deltas)")).toBeLessThan(
      source.indexOf('reply({ ok: true, draftId, protocol: 1 })')
    );
    expect(source).not.toContain('draftProjectionService.buildRoomSnapshot');
  });

  it('uses one allowlisted mapper for persisted pick and lifecycle replay', () => {
    const source = readSocketServer();

    expect(source).toContain('toDraftBackfillDelta');
    expect(source).toContain('const delta = toDraftBackfillDelta(event)');
    expect(source).not.toContain('DraftClockPayloadSchema.safeParse');
  });

  it('keeps durable outbox draining independent from ephemeral subscription startup', () => {
    const source = readSocketServer();

    expect(source).toContain('const ensureDraftRealtimeSubscription = async');
    expect(source).toContain('const drainDraftOutbox = async');
    expect(source).toContain('void ensureDraftRealtimeSubscription();');
    expect(source).toContain('void drainDraftOutbox();');
    expect(source).toContain(
      'setInterval(() => void ensureDraftRealtimeSubscription(), draftOutboxDrainIntervalMs)'
    );
    expect(source).toContain(
      'setInterval(() => void drainDraftOutbox(), draftOutboxDrainIntervalMs)'
    );
  });

  it('cleans up both room aliases and the participant reservation together', () => {
    const source = readSocketServer();
    const cleanupSource = source.slice(
      source.indexOf('const removeDraftSubscription'),
      source.indexOf('// Join draft room with enhanced validation')
    );

    expect(cleanupSource).toContain('Promise.allSettled');
    expect(cleanupSource).toContain('socket.leave(draftId)');
    expect(cleanupSource).toContain('socket.leave(`draft:${draftId}`)');
    expect(cleanupSource).toContain('draftRoomStore.removeParticipant(draftId, socket.id)');
    expect(cleanupSource).toContain('delete socket.data.draftRealtimeProtocol');
  });
});

function readSocketServer(): string {
  return readFileSync(join(process.cwd(), 'src/server/socketioServer.ts'), 'utf8');
}
