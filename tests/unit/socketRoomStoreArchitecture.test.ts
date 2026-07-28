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

  it('retains per-process timer handles without using them as room state', () => {
    const source = readSocketServer();

    expect(source).toContain(
      'const roomTimers = new Map<string, ReturnType<typeof setInterval> | undefined>()'
    );
    expect(source).toContain('if (!(await renew()))');
  });
});

function readSocketServer(): string {
  return readFileSync(join(process.cwd(), 'src/server/socketioServer.ts'), 'utf8');
}
