import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft room layout sizing', () => {
  it('lets the live draft shell span the viewport while fixed side panels keep the player table flexible', () => {
    const unifiedDraftRoom = readFileSync(
      join(process.cwd(), 'src/components/draft/UnifiedDraftRoom.tsx'),
      'utf8'
    );
    const livePickHeader = readFileSync(
      join(process.cwd(), 'src/components/LivePickHeader.tsx'),
      'utf8'
    );
    const draftControls = readFileSync(
      join(process.cwd(), 'src/components/draft/DraftControls.tsx'),
      'utf8'
    );
    const draftStatusBanner = readFileSync(
      join(process.cwd(), 'src/components/draft/DraftStatusBanner.tsx'),
      'utf8'
    );

    expect(unifiedDraftRoom).toContain(
      'xl:grid-cols-[minmax(16rem,20rem)_minmax(54rem,1fr)_minmax(20rem,22rem)]'
    );
    expect(unifiedDraftRoom).toContain('2xl:grid-cols-[20rem_minmax(64rem,1fr)_22rem]');
    expect(unifiedDraftRoom).toContain('w-full px-3 pb-6 sm:px-5 lg:px-8');
    expect(unifiedDraftRoom).toContain('grid min-h-[calc(100vh-24rem)] items-stretch gap-4');
    expect(unifiedDraftRoom).toContain('className="flex min-h-0 min-w-0 overflow-x-auto"');
    expect(unifiedDraftRoom).toContain('className="h-full min-h-[28rem]"');
    expect(unifiedDraftRoom).not.toContain('<DraftAnalytics');
    expect(livePickHeader).not.toContain('Latest draft activity');
    expect(livePickHeader).not.toContain('Latest pick');
    expect(unifiedDraftRoom).not.toContain('lg:grid-cols-[17rem_minmax(0,1fr)_20rem]');
    expect(unifiedDraftRoom).not.toContain('max-w-[1780px]');
    expect(livePickHeader).not.toContain('max-w-[1400px]');
    expect(draftControls).not.toContain('max-w-[1400px]');
    expect(draftStatusBanner).not.toContain('max-w-[1400px]');
  });
});
