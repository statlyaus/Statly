import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unified draft room design architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/components/draft/UnifiedDraftRoom.tsx'), 'utf8');

  it('uses broadcast theme tokens for the draft room shell', () => {
    const roomSource = source();

    expect(roomSource).toContain('bg-[color:var(--draft-broadcast-page)]');
    expect(roomSource).toContain('text-[color:var(--draft-broadcast-text)]');
    expect(roomSource).toContain('border-[color:var(--draft-broadcast-border)]');
    expect(roomSource).toContain('bg-[color:var(--draft-broadcast-panel)]');
    expect(roomSource).toContain('[--card:var(--draft-broadcast-panel)]');
    expect(roomSource).toContain('bg-[color:var(--draft-broadcast-overlay)]');
    expect(roomSource).toContain('aria-label="Draft complete next steps"');
    expect(roomSource).toContain(
      'border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] p-5'
    );
    expect(roomSource).toContain(
      'className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)]'
    );
    expect(roomSource).toContain('text-muted-foreground');
    expect(roomSource).toContain('focus-visible:ring-ring');
    expect(roomSource).not.toContain('border border-border bg-card');
    expect(roomSource).not.toContain('bg-primary text-primary-foreground');
    expect(roomSource).not.toContain('bg-foreground/50');
    expect(roomSource).not.toContain('bg-card p-4 text-card-foreground');
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

    expect(roomSource).toContain('import DraftLeftRail');
    expect(roomSource).toContain('<DraftLeftRail');
    expect(roomSource).toContain('<PlayerGrid');
    expect(roomSource).toContain('<DraftQueue');
    expect(roomSource).toContain('<DraftWatchlist');
    expect(roomSource).toContain('<PickFeed');
    expect(roomSource).toContain('aria-label="Draft board"');
    expect(roomSource).toContain('aria-label="Open Pick Feed"');
    expect(roomSource).not.toContain('import DraftAnalytics');
    expect(roomSource).not.toContain('<DraftAnalytics');
    expect(roomSource).not.toContain('aria-label="Draft analytics"');
    expect(roomSource).not.toContain('activeTab');
    expect(roomSource).not.toContain('aria-label="Draft room sections"');
  });

  it('wires scheduled draft start to the authenticated draft context command', () => {
    const roomSource = source();

    expect(roomSource).toContain('onStartDraft={draft.startDraft}');
    expect(roomSource).not.toContain('onStartDraft={() => draft.forceRefresh()}');
  });

  it('uses one responsive board layout instead of a fixed route-level pick-feed rail', () => {
    const roomSource = source();

    expect(roomSource).toContain('grid min-h-[calc(100vh-24rem)] items-stretch gap-4');
    expect(roomSource).toContain(
      'xl:grid-cols-[minmax(18rem,20rem)_minmax(0,1fr)_minmax(20rem,22rem)]'
    );
    expect(roomSource).toContain('className="flex min-h-0 min-w-0 overflow-x-auto"');
    expect(roomSource).toContain('max-w-[2100px]');
    expect(roomSource).toContain('min-h-[30rem]');
    expect(roomSource).toContain('bg-[color:var(--draft-broadcast-table)]');
    expect(roomSource).toContain('[--card:var(--draft-broadcast-table)]');
    expect(roomSource).toContain(
      'className="sticky top-4 flex h-full min-h-[30rem] max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] p-3 text-[color:var(--draft-broadcast-text)]'
    );
    expect(roomSource).toContain('2xl:grid-cols-[20rem_minmax(0,1fr)_22rem]');
    expect(roomSource).toContain('hidden min-h-0 lg:block');
    expect(roomSource).not.toContain('md:pr-[23rem]');
    expect(roomSource).not.toContain('fixed right-0 top-0 hidden h-full w-[22rem]');
  });
});
