import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('draft room runtime source of truth', () => {
  it('keeps the live draft route on the unified draft room surface', () => {
    const routeSource = read('src/app/(app)/drafts/[id]/page.tsx');

    expect(routeSource).toContain(
      "import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom'"
    );
    expect(routeSource).toContain('<DraftProvider draftId={draftId} userId={user.uid}>');
    expect(routeSource).toContain('<UnifiedDraftRoom draftId={draftId} userId={user.uid} />');
    expect(routeSource).not.toMatch(/AvailablePlayersTable(_new)?/);
    expect(routeSource).not.toMatch(/\bDraftLobby\b/);
  });

  it('keeps the unified room wired to the current table and rails', () => {
    const roomSource = read('src/components/draft/UnifiedDraftRoom.tsx');

    expect(roomSource).toContain("import PlayerGrid from './PlayerGrid'");
    expect(roomSource).toMatch(/import DraftLeftRail\b[\s\S]+from '\.\/DraftLeftRail';/);
    expect(roomSource).toContain("import PickFeed from '@/components/PickFeed'");
    expect(roomSource).toContain('<PlayerGrid');
    expect(roomSource).toContain('<DraftLeftRail');
    expect(roomSource).toContain('<PickFeed');
    expect(roomSource).not.toMatch(/AvailablePlayersTable(_new)?/);
    expect(roomSource).not.toMatch(/\bDraftLobby\b/);
  });

  it('documents the deployment, archive, and close-out requirements', () => {
    const sourceOfTruth = read('docs/superpowers/specs/2026-06-13-draft-room-source-of-truth.md');

    expect(sourceOfTruth).toContain('Live draft room route: `src/app/(app)/drafts/[id]/page.tsx`');
    expect(sourceOfTruth).toContain('Live room shell: `src/components/draft/UnifiedDraftRoom.tsx`');
    expect(sourceOfTruth).toContain('Mandatory Close-Out Checklist');
    expect(sourceOfTruth).toContain('Deployment surface check');
    expect(sourceOfTruth).toContain('Archive/deprecation audit');
    expect(sourceOfTruth).toContain('Dirty-file callout');
    expect(sourceOfTruth).toContain('Do not deploy or commit `prisma/dev.db`');
  });

  it('marks older available-player tables as reference-only surfaces', () => {
    const legacyTable = read('src/components/AvailablePlayersTable.tsx');
    const legacyNewTable = read('src/components/AvailablePlayersTable_new.tsx');

    expect(legacyTable).toContain('Legacy reference table only');
    expect(legacyTable).toContain('src/components/draft/PlayerGrid.tsx');
    expect(legacyNewTable).toContain('Legacy reference table only');
    expect(legacyNewTable).toContain('src/components/draft/PlayerGrid.tsx');
  });
});
