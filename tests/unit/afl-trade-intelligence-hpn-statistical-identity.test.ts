import { describe, expect, it } from 'vitest';
import { authenticateAflTradeHpnStatisticalSources } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSourceAuthentication';
import { setup } from '../testUtils/hpnStatisticalSourceFixture';

describe('HPN statistical canonical identity inspection', () => {
  it('returns both current resolution snapshots without granting decision authority', async () => {
    const f = setup();
    const result = await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell);
    expect(result.identities).toHaveLength(2);
    expect(result.identities.map(({ role }) => role)).toEqual(['primary', 'corroborating']);
    expect(result.identities[0]).toMatchObject({
      player: { canonicalId: f.cell.scope.playerId },
      match: { canonicalId: f.cell.scope.matchId },
      club: { canonicalId: f.cell.scope.clubId },
    });
    expect(result.identityAuthority).toBe('read_only_snapshot_requires_locked_recheck');
    expect(result.calculationEligible).toBe(false);
    const query = f.statements.find((sql) => sql.includes('AS player_resolution'))!;
    expect(query).toContain('outcome_provider_assignment_continuity_current');
    expect(query).toContain('successor.supersedes_decision_id=resolution.decision_id');
    expect(query).toContain("'{content,proposal,content,staging,providerDecodedRowId}'");
  });

  it.each([0, 1])('rejects a missing canonical player resolution on source %i', async (index) => {
    const f = setup();
    Object.assign(f.state.identities[index], { player_resolution: null });
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'player resolution'
    );
  });
  it.each(['player_resolution', 'match_resolution'] as const)(
    'rejects the wrong %s',
    async (field) => {
      const f = setup();
      f.state.identities[0][field].canonicalId = 'different';
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
      ).rejects.toThrow('current canonical');
    }
  );
  it.each([
    { season_year: 2019 },
    { competition: 'AFLW' },
    { home_club_id: 'other-team' },
    { away_club_native_id: 'HomeClub' },
  ])('rejects cross-scope or ambiguous match sides: %j', async (change) => {
    const f = setup();
    Object.assign(f.state.identities[0], change);
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
    ).rejects.toThrow();
  });
  it('rejects a club unrelated to the claimed match side', async () => {
    const f = setup();
    f.state.identities[0].home_club_resolutions[0].canonicalId = 'opponent';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'current canonical'
    );
  });
  it('rejects absent or ambiguous current club resolutions', async () => {
    const f = setup();
    const resolution = f.state.identities[0].home_club_resolutions[0];
    for (const resolutions of [[], [resolution, resolution]]) {
      f.state.identities[0].home_club_resolutions = resolutions;
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
      ).rejects.toThrow('absent or ambiguous');
    }
  });
  it('rejects inactive or mismatched assignment ownership', async () => {
    const f = setup();
    const resolution = f.state.identities[0].match_resolution;
    resolution.assignmentStatus = 'withdrawn';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'current active assignment'
    );
    resolution.assignmentStatus = 'active';
    resolution.assignmentDecisionId = 'other-decision';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'current active assignment'
    );
  });
  it('preserves candidate-only players without inventing reusable assignment authority', async () => {
    const f = setup();
    const resolution = f.state.identities[0].player_resolution;
    Object.assign(resolution, {
      resolutionScope: 'candidate_only',
      assignmentDecisionId: null,
      assignmentStatus: null,
    });
    expect(
      (await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).identities[0].player
    ).toMatchObject({
      resolutionScope: 'candidate_only',
      assignmentDecision: null,
    });
    resolution.assignmentStatus = 'active';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'cannot claim a reusable assignment'
    );
  });
});
