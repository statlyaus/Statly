import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft route league affiliation', () => {
  it('serializes league identity and clock state from the authorized draft read', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/drafts/[id]/route.ts'), 'utf8');

    expect(source).toContain('draftAuthorizedReadService.readReadyForMember({');
    expect(source).toContain('prisma.draft.findFirst({');
    expect(source).toContain('leagueId: draft.leagueId');
    expect(source).toContain('clock,');
  });
});
