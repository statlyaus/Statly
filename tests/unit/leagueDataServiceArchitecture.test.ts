import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('leagueDataService Firestore architecture', () => {
  it('routes waiver mutations through server APIs instead of direct client Firestore writes', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/leagueDataService.ts'), 'utf8');
    const submitMethod = source.slice(
      source.indexOf('async submitWaiverClaim('),
      source.indexOf('  /**\n   * Propose trade')
    );
    const cancelMethod = source.slice(
      source.indexOf('async cancelLeagueWaiverClaim('),
      source.indexOf('  /**\n   * Real-time subscription for league activity feed')
    );

    expect(submitMethod).toContain('/api/leagues/${leagueId}/waivers/submit');
    expect(submitMethod).not.toContain('addDoc(');
    expect(submitMethod).not.toContain('getLeagueWaiversCollection');

    expect(cancelMethod).toContain('/api/leagues/${leagueId}/waivers/cancel');
    expect(cancelMethod).not.toContain('runTransaction(');
    expect(cancelMethod).not.toContain('getLeagueWaiversCollection');
    expect(cancelMethod).not.toContain('tx.update(');
  });

  it('routes trade proposals through server APIs instead of direct client Firestore writes', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/leagueDataService.ts'), 'utf8');
    const proposeMethod = source.slice(
      source.indexOf('async proposeTrade('),
      source.indexOf('  /**\n   * Cancel a waiver claim')
    );

    expect(proposeMethod).toContain('/api/leagues/${leagueId}/trades');
    expect(proposeMethod).not.toContain('addDoc(');
    expect(proposeMethod).not.toContain('getLeagueTradesCollection');
  });
});
