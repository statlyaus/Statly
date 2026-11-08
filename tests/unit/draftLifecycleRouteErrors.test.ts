import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  startDraft: vi.fn(),
  pauseDraft: vi.fn(),
  resumeDraft: vi.fn(),
  autoPick: vi.fn(),
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: service,
}));
vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: { publishCommandResult: vi.fn() },
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: vi.fn(),
}));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn(async () => 'commissioner') }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as autoPick } from '@/app/api/drafts/[id]/auto-pick/route';
import { POST as pause } from '@/app/api/drafts/[id]/pause/route';
import { POST as resume } from '@/app/api/drafts/[id]/resume/route';
import { POST as start } from '@/app/api/drafts/[id]/start/route';

const routes = [
  ['start', start, service.startDraft],
  ['pause', pause, service.pauseDraft],
  ['resume', resume, service.resumeDraft],
  ['auto-pick', autoPick, service.autoPick],
] as const;

function command(name: string) {
  return new NextRequest(`http://localhost/api/drafts/draft-1/${name}`, { method: 'POST' });
}

describe('pick room lifecycle route errors', () => {
  beforeEach(() => {
    for (const [, , handler] of routes) handler.mockReset();
  });

  it.each(routes)(
    '%s keeps a refusal detail that contains a colon',
    async (name, post, handler) => {
      handler.mockRejectedValue(new Error('conflict:Draft state changed: reload the room'));

      const response = await post(command(name), { params: Promise.resolve({ id: 'draft-1' }) });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.message).toBe('Draft state changed: reload the room');
    }
  );

  it.each(routes)(
    "%s passes the server's forbidden reason through",
    async (name, post, handler) => {
      handler.mockRejectedValue(
        new Error('forbidden:Commissioner access required to pause drafts')
      );

      const response = await post(command(name), { params: Promise.resolve({ id: 'draft-1' }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.message).toBe('Commissioner access required to pause drafts');
    }
  );
});
