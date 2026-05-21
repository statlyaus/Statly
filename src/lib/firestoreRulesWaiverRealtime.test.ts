import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('firestore waiver realtime rules', () => {
  const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

  it('allows league members to read waiver priority projections', () => {
    expect(rules).toMatch(/match\s+\/waiverPriorities\/\{userId\}/);
    expect(rules).toMatch(
      /match\s+\/waiverPriorities\/\{userId\}\s*\{\s*allow read: if isAuthenticated\(\) && isLeagueMember\(leagueId\);/
    );
  });

  it('allows league members to read league activity projections', () => {
    expect(rules).toMatch(/match\s+\/activity\/\{activityId\}/);
    expect(rules).toMatch(
      /match\s+\/activity\/\{activityId\}\s*\{\s*allow read: if isAuthenticated\(\) && isLeagueMember\(leagueId\);/
    );
  });
});
