import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getSocketIoConfig } from '@/lib/socketioConfig';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('getSocketIoConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses the repo-local SOCKETIO_PORT alias for the socket server port', () => {
    delete process.env.SOCKET_IO_PORT;
    delete process.env.PORT;
    process.env.SOCKETIO_PORT = '4001';
    process.env.SOCKET_IO_CORS_ORIGINS = 'http://localhost:3010';

    expect(getSocketIoConfig().server.port).toBe(4001);
  });

  it('keeps the browser client fallback aligned with the socket server default port', () => {
    const socketClientSource = read('src/lib/socketioClient.ts');

    expect(getSocketIoConfig().server.port).toBe(3002);
    expect(socketClientSource).toContain("'http://localhost:3002'");
    expect(socketClientSource).not.toContain("'http://localhost:3001'");
  });

  it('authenticates socket connections from the Socket.IO handshake token', () => {
    const socketServerSource = read('src/server/socketioServer.ts');

    expect(socketServerSource).toContain('socket.handshake.auth.token');
    expect(socketServerSource).toContain('validateAuthToken(token)');
    expect(socketServerSource).toContain("token.startsWith('dev:')");
    expect(socketServerSource).not.toContain("req.headers['authorization']");
    expect(socketServerSource).not.toContain('socket.data.userId = userId');
    expect(socketServerSource).not.toContain("userId: userId || 'anonymous'");
  });

  it('sources reconnect backfill from persisted draft events', () => {
    const socketServerSource = read('src/server/socketioServer.ts');

    expect(socketServerSource).toContain('prisma.draftEvent.findMany');
    expect(socketServerSource).toContain('createdAt: { gt: new Date(since) }');
    expect(socketServerSource).not.toContain('getRedis');
    expect(socketServerSource).not.toContain('zrangebyscore');
  });

  it('does not expose fake Socket.IO success semantics from the Next route', () => {
    const socketRouteSource = read('src/app/api/socketio/route.ts');

    expect(socketRouteSource).not.toContain('Socket.IO Ready');
    expect(socketRouteSource).not.toContain('Core draft functionality working');
    expect(socketRouteSource).not.toContain('status: "ok"');
  });
});
