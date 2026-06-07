import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unified draft room design architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/components/draft/UnifiedDraftRoom.tsx'), 'utf8');

  it('uses semantic theme tokens for the draft room shell', () => {
    const roomSource = source();

    expect(roomSource).toContain('min-h-screen bg-background text-foreground');
    expect(roomSource).toContain('border border-border bg-card');
    expect(roomSource).toContain('text-muted-foreground');
    expect(roomSource).toContain('bg-primary text-primary-foreground');
    expect(roomSource).toContain('focus-visible:ring-ring');
    expect(roomSource).toContain('bg-muted/80');
  });

  it('does not reintroduce legacy hard-coded shell colors', () => {
    const roomSource = source();

    expect(roomSource).not.toMatch(/\bbg-(gray|blue|slate|white|black|red)-/);
    expect(roomSource).not.toMatch(/\btext-(gray|blue|slate|white|red)-/);
    expect(roomSource).not.toMatch(/\bborder-(gray|blue|slate|red)-/);
    expect(roomSource).not.toContain('bg-opacity-50');
  });

  it('keeps the existing draft room composition intact', () => {
    const roomSource = source();

    expect(roomSource).toContain('<PlayerGrid');
    expect(roomSource).toContain('<DraftQueue');
    expect(roomSource).toContain('<DraftWatchlist');
    expect(roomSource).toContain('<DraftAnalytics');
    expect(roomSource).toContain('<PickFeed');
    expect(roomSource).toContain('role="tablist"');
    expect(roomSource).toContain('aria-label="Open Pick Feed"');
  });

  it('wires scheduled draft start to the authenticated draft context command', () => {
    const roomSource = source();

    expect(roomSource).toContain('onStartDraft={draft.startDraft}');
    expect(roomSource).not.toContain('onStartDraft={() => draft.forceRefresh()}');
  });

  it('reserves desktop pick-feed rail space above and below the draft header controls', () => {
    const roomSource = source();

    expect(roomSource).toContain('space-y-4 pb-4 md:pr-[23rem] xl:pr-[25rem]');
    expect(roomSource).toContain(
      'px-3 pb-6 sm:px-5 lg:px-8 md:pr-[23rem] xl:pr-[25rem]'
    );
    expect(roomSource).toContain('fixed right-0 top-0 hidden h-full w-[22rem]');
  });
});
