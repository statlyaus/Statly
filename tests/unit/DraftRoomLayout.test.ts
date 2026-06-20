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
    const playerGrid = readFileSync(
      join(process.cwd(), 'src/components/draft/PlayerGrid.tsx'),
      'utf8'
    );

    expect(unifiedDraftRoom).toContain(
      'xl:grid-cols-[minmax(16rem,20rem)_minmax(54rem,1fr)_minmax(20rem,22rem)]'
    );
    expect(unifiedDraftRoom).toContain('2xl:grid-cols-[20rem_minmax(64rem,1fr)_22rem]');
    expect(unifiedDraftRoom).toContain('lg:min-h-[calc(100vh-10rem)]');
    expect(unifiedDraftRoom).toContain('lg:h-[calc(100vh-10rem)]');
    expect(unifiedDraftRoom).toContain('w-full px-3 pb-6 sm:px-5 lg:px-8');
    expect(unifiedDraftRoom).toContain('className="min-w-0 overflow-x-auto lg:h-[calc(100vh-10rem)]"');
    expect(unifiedDraftRoom).not.toContain('aria-label="Draft analytics"');
    expect(unifiedDraftRoom).not.toContain('<DraftAnalytics');
    expect(unifiedDraftRoom).not.toContain("import DraftAnalytics from './DraftAnalytics'");
    expect(unifiedDraftRoom).not.toContain('lg:grid-cols-[17rem_minmax(0,1fr)_20rem]');
    expect(unifiedDraftRoom).not.toContain('max-w-[1780px]');
    expect(playerGrid).not.toContain('max-h-[680px]');
    expect(playerGrid).toContain('flex h-full min-h-[28rem] flex-col');
    expect(livePickHeader).not.toContain('max-w-[1400px]');
    expect(draftControls).not.toContain('max-w-[1400px]');
    expect(draftStatusBanner).not.toContain('max-w-[1400px]');
  });
});
