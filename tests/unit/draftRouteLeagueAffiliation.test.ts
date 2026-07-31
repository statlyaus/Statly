import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft route league affiliation', () => {
  it('serializes the draft league id in the lean draft payload', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/drafts/[id]/route.ts'), 'utf8');

    expect(source).toContain('leagueId: true');
    expect(source).toContain('schedulingVersion: true');
    expect(source).toContain('pickDeadlineAt: true');
    expect(source).toContain('leagueId: draft.leagueId');
    expect(source).toContain('clock,');
  });
});
