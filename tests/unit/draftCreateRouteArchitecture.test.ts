import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft create route architecture', () => {
  it('uses commissioner settings and participant order when creating drafts', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/drafts/route.ts'), 'utf8');

    expect(source).toContain('isValidPickSeconds(body.timePerPick)');
    expect(source).toContain('normalizeDraftPositionLimits(body.positionLimits)');
    expect(source).toContain('normalizeDraftAutoPickRules(body.autoPickRules)');
    expect(source).toContain('calculateDraftCapacity');
    expect(source).toContain('activePlayerCount');
    expect(source).toContain('orderMembersForDraft(league.members, body.participants, pickOrder)');
    expect(source).toContain('data: { draftSlot: i + 1 }');
    expect(source).toContain('memberId: orderedMembers[i].id');
    expect(source).toContain('positionLimitsJson: JSON.stringify(positionLimits)');
    expect(source).toContain('autoPickRulesJson: JSON.stringify(autoPickRules)');
  });
});
