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
      'xl:grid-cols-[minmax(18rem,20rem)_minmax(0,1fr)_minmax(20rem,22rem)]'
    );
    expect(unifiedDraftRoom).toContain('2xl:grid-cols-[20rem_minmax(0,1fr)_22rem]');
    expect(unifiedDraftRoom).toContain('mx-auto w-full max-w-[2100px] px-4 pb-6 sm:px-6 lg:px-8');
    expect(unifiedDraftRoom).toContain('grid min-h-[calc(100vh-24rem)] items-stretch gap-4');
    expect(unifiedDraftRoom).toContain('className="flex min-h-0 min-w-0 overflow-x-auto"');
    expect(unifiedDraftRoom).toContain('min-h-[30rem]');
    expect(unifiedDraftRoom).toContain('bg-[color:var(--draft-broadcast-table)]');
    expect(unifiedDraftRoom).not.toContain('<DraftAnalytics');
    expect(livePickHeader).not.toContain('Latest draft activity');
    expect(livePickHeader).not.toContain('Latest pick');
    expect(unifiedDraftRoom).not.toContain('lg:grid-cols-[17rem_minmax(0,1fr)_20rem]');
    expect(unifiedDraftRoom).not.toContain('max-w-[1780px]');
    expect(livePickHeader).not.toContain('max-w-[1400px]');
    expect(draftControls).not.toContain('max-w-[1400px]');
    expect(draftStatusBanner).not.toContain('max-w-[1400px]');
  });

  it('keeps the live draft top chrome on the broadcast token system', () => {
    const draftControls = readFileSync(
      join(process.cwd(), 'src/components/draft/DraftControls.tsx'),
      'utf8'
    );
    const draftStatusBanner = readFileSync(
      join(process.cwd(), 'src/components/draft/DraftStatusBanner.tsx'),
      'utf8'
    );

    for (const source of [draftControls, draftStatusBanner]) {
      expect(source).toContain('bg-[color:var(--draft-broadcast-panel)]');
      expect(source).toContain('border-[color:var(--draft-broadcast-border)]');
      expect(source).toContain('text-[color:var(--draft-broadcast-text)]');
      expect(source).not.toContain('bg-card/95');
      expect(source).not.toContain('border-border/60');
    }
  });
});
