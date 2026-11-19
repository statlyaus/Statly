import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('drops and trades wait for the League row with a bounded wait (#1343)', () => {
  it('a drop locks with the interactive bound and answers a busy league with LEAGUE_BUSY', () => {
    const route = read('src/app/api/leagues/[id]/actions/[userId]/route.ts');
    expect(route).toContain('lockLeagueRowOrBusy(tx, leagueId, INTERACTIVE_LEAGUE_LOCK.waitMs)');
    expect(route).toContain('INTERACTIVE_LEAGUE_LOCK.transaction');
    expect(route).toContain('error instanceof LeagueBusyError');
    expect(route).not.toMatch(/\blockLeagueRow\(/u);
  });

  it('trade commands use the interactive bound and the trade cron the scheduled one', () => {
    const service = read('src/server/leagues/trades/tradeService.ts');
    expect(service).toContain(
      'lockLeagueRowOrBusy(tx, access.leagueId, INTERACTIVE_LEAGUE_LOCK.waitMs)'
    );
    expect(service.match(/SCHEDULED_LEAGUE_LOCK\.waitMs/gu)).toHaveLength(2);
    expect(service).toContain("new TradeServiceError('LEAGUE_BUSY', error.message, 503)");
    expect(service).not.toMatch(/\blockLeagueRow\(/u);
  });
});
