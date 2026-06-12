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
      'lg:grid-cols-[17rem_minmax(0,1fr)_20rem] xl:grid-cols-[20rem_minmax(0,1fr)_22rem]'
    );
    expect(unifiedDraftRoom).toContain('w-full px-3 pb-6 sm:px-5 lg:px-8');
    expect(unifiedDraftRoom).not.toContain('max-w-[1780px]');
    expect(livePickHeader).not.toContain('max-w-[1400px]');
    expect(draftControls).not.toContain('max-w-[1400px]');
    expect(draftStatusBanner).not.toContain('max-w-[1400px]');
  });
});
