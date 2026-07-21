import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league Trade Centre route architecture', () => {
  it('keeps reads and proposal commands behind authenticated shared server boundaries', () => {
    const routePath = join(process.cwd(), 'src/app/api/leagues/[id]/trades/route.ts');

    expect(existsSync(routePath)).toBe(true);

    const source = readFileSync(routePath, 'utf8');
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function POST');
    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('loadAuthorizedLeagueTradeCentre');
    expect(source).toContain('createLeagueTrade(leagueId, userId, input)');
    expect(source).toContain("'Cache-Control': 'private, no-store'");
    expect(source).toContain('error instanceof TradeServiceError');
    expect(source).not.toContain('verifyLeagueMembership');
    expect(source).not.toContain('adminDb');
    expect(source).not.toContain('fromUserId');
    expect(source).not.toContain('fromTeamId');
  });

  it('keeps trade actions behind the same authenticated command service', () => {
    const routePath = join(
      process.cwd(),
      'src/app/api/leagues/[id]/trades/[tradeId]/actions/route.ts'
    );

    expect(existsSync(routePath)).toBe(true);

    const source = readFileSync(routePath, 'utf8');
    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain(
      'executeLeagueTradeAction(leagueId, userId, tradeId, input)'
    );
    expect(source).toContain("'Cache-Control': 'private, no-store'");
    expect(source).toContain('error instanceof TradeServiceError');
    expect(source).not.toContain('adminDb');
    expect(source).not.toContain('userId:');
    expect(source).not.toContain('memberId:');
    expect(source).not.toContain('teamId:');
  });
});
