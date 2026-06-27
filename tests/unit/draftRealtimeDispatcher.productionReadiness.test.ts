import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft realtime dispatcher production readiness', () => {
  it('does not warn for expected worker-side local emit skips', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('logger.debug');
    expect(source).toContain('Skipping local realtime emit without attached Socket.IO server');
    expect(source).not.toContain('Skipping realtime dispatch without attached Socket.IO server');
  });

  it('includes the authoritative pick deadline in state patch deltas', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('pickDeadlineAt: state.currentPick.expiresAt.toISOString()');
  });

  it('surfaces next pick metadata on pick deltas so the client clock advances', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('payload: this.buildPickDeltaPayload(pickPayload)');
    expect(source).toContain('currentPick: pick.currentPick');
    expect(source).toContain('round: pick.nextRound');
    expect(source).toContain('direction: pick.nextDirection');
    expect(source).toContain('pickDeadlineAt: pick.pickDeadlineAt');
  });
});
