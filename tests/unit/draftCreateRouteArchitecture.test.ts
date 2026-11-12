import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft create route architecture', () => {
  it('uses commissioner settings and participant order when creating drafts', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/drafts/route.ts'), 'utf8');

    expect(source).toContain('isValidPickSeconds(body.timePerPick)');
    expect(source).toContain("typeof body.leagueSize !== 'number'");
    expect(source).toContain('!Number.isInteger(body.leagueSize)');
    expect(source).toContain('normalizeDraftPositionLimits(body.positionLimits)');
    expect(source).toContain('normalizeDraftAutoPickRules(body.autoPickRules)');
    expect(source).toContain('calculateDraftCapacity');
    expect(source).toContain('activePlayerCount');
    expect(source).toContain('orderMembersForDraft(league.members, body.participants, pickOrder)');
    // BR-09: the order is written by the shared writer, which leaves a Bloodsucker out.
    expect(source).toContain('splitDraftingMembers(orderedMembers, league.settings)');
    expect(source).toContain('writeDraftOrder(tx, {');
    expect(source).toContain('positionLimitsJson: positionLimits');
    expect(source).toContain('autoPickRulesJson: autoPickRules');
  });
});
