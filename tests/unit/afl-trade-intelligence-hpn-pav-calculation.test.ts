import { describe, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  calculateAflTradeHpnPavSeason,
  createAflTradeHpnPavMethod,
} from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';

const sha = (character: string) => character.repeat(64);
const methodBytes = new TextEncoder().encode('<html><body>HPN PAV method</body></html>');

const ordinalSort = (values: string[]) => values.sort((left, right) => (left < right ? -1 : 1));

function player(playerId: string, multiplier = 1) {
  return {
    playerId,
    totalPoints: 40 * multiplier,
    hitOuts: 4 * multiplier,
    goalAssists: 2 * multiplier,
    inside50s: 10 * multiplier,
    marks: 20 * multiplier,
    marksInside50: 2 * multiplier,
    freeKicksFor: 6 * multiplier,
    freeKicksAgainst: 4 * multiplier,
    rebound50s: 5 * multiplier,
    onePercenters: 5 * multiplier,
    clearances: 5 * multiplier,
    tackles: 10 * multiplier,
    sourceRowIds: [`row:${playerId}`],
  };
}

function input() {
  const resultSourceRowIds = ['row:result:2025'];
  const teams = [
    {
      teamId: 'club:a',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [player('player:a1', 2), player('player:a2')],
    },
    {
      teamId: 'club:b',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [player('player:b1'), player('player:b2', 2)],
    },
  ];
  const sourceRowIds = ordinalSort([
    ...resultSourceRowIds,
    ...teams.flatMap(({ players }) => players.flatMap(({ sourceRowIds }) => sourceRowIds)),
  ]);
  const snapshotBytes = new TextEncoder().encode(JSON.stringify({ sourceRowIds }));
  const snapshotArtifact = createAflTradeByteArtifactRef(
    snapshotBytes,
    'application/json',
    '2025-09-27T00:00:00.000Z'
  );
  const snapshot = {
    sourceSnapshotId: `source-snapshot:${snapshotArtifact.contentSha256}`,
    sourceSnapshotSha256: snapshotArtifact.contentSha256,
    sourceArtifact: snapshotArtifact,
    captureId: 'capture:2025-player-stats',
    normalizationRunId: `provider-normalization-run:${sha('b')}`,
    seasonYear: 2025,
    capturedAt: '2025-09-27T00:00:00.000Z',
    finalizedAt: '2026-08-09T00:00:00.000Z',
    sourceRowIds,
  };
  const rowMembershipArtifact = createAflTradeCanonicalJsonArtifactRef(
    {
      schemaVersion: 'afl-trade-hpn-pav-source-row-membership/v1',
      sourceSnapshotId: snapshot.sourceSnapshotId,
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
      sourceArtifactId: snapshot.sourceArtifact.artifactId,
      captureId: snapshot.captureId,
      normalizationRunId: snapshot.normalizationRunId,
      seasonYear: snapshot.seasonYear,
      capturedAt: snapshot.capturedAt,
      finalizedAt: snapshot.finalizedAt,
      sourceRowIds: snapshot.sourceRowIds,
    },
    snapshot.finalizedAt
  );
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear: 2025,
    effectiveThrough: '2025-09-27T00:00:00.000Z',
    calculatedAt: '2026-08-10T00:00:00.000Z',
    method: createAflTradeHpnPavMethod({
      sourceArtifact: createAflTradeByteArtifactRef(
        methodBytes,
        'text/html',
        '2026-08-09T00:00:00.000Z'
      ),
      sourceBytes: methodBytes,
      capturedAt: '2026-08-09T00:00:00.000Z',
    }),
    sourceSnapshots: [{ ...snapshot, rowMembershipArtifact }],
    resultSourceRowIds,
    teams,
  };
}

describe('HPN Player Approximate Value calculation', () => {
  it('seals the published method and retained source bytes', () => {
    const method = input().method;

    expect(method.content.valueUnit).toBe('season_pav');
    expect(method.content.supportedEra).toEqual({ fromSeason: 1998, throughSeason: null });
    expect(method.content.sourceArtifact.mediaType).toBe('text/html');
    expect(method.content.sourceArtifact.byteLength).toBe(methodBytes.byteLength);
    expect(method.methodId).toMatch(/^hpn-pav-method:[a-f0-9]{64}$/);
  });

  it('allocates exactly 100 PAV per team in each component and conserves every team allocation', () => {
    const calculation = calculateAflTradeHpnPavSeason(input());

    expect(calculation.content.league.componentPools).toEqual({
      offensivePav: 200,
      midfieldPav: 200,
      defensivePav: 200,
    });
    expect(calculation.content.league.totalPav).toBe(600);
    expect(calculation.content.teams.reduce((sum, team) => sum + team.offensivePav, 0)).toBeCloseTo(
      200,
      10
    );
    expect(calculation.content.teams.reduce((sum, team) => sum + team.midfieldPav, 0)).toBeCloseTo(
      200,
      10
    );
    expect(calculation.content.teams.reduce((sum, team) => sum + team.defensivePav, 0)).toBeCloseTo(
      200,
      10
    );
    for (const team of calculation.content.teams) {
      const players = calculation.content.players.filter(({ teamId }) => teamId === team.teamId);
      expect(players.reduce((sum, value) => sum + value.offensivePav, 0)).toBeCloseTo(
        team.offensivePav,
        10
      );
      expect(players.reduce((sum, value) => sum + value.midfieldPav, 0)).toBeCloseTo(
        team.midfieldPav,
        10
      );
      expect(players.reduce((sum, value) => sum + value.defensivePav, 0)).toBeCloseTo(
        team.defensivePav,
        10
      );
    }
  });

  it('keeps component scores and component PAV visible instead of emitting an opaque total', () => {
    const calculation = calculateAflTradeHpnPavSeason(input());
    const first = calculation.content.players.find(({ playerId }) => playerId === 'player:a1');

    expect(first).toMatchObject({
      offensiveScore: 122,
      midfieldScore: 576,
      defensiveScore: 346.666666666667,
    });
    expect(first?.totalPav).toBeCloseTo(
      (first?.offensivePav ?? 0) + (first?.midfieldPav ?? 0) + (first?.defensivePav ?? 0),
      10
    );
  });

  it('is deterministic across team and player input ordering', () => {
    const original = input();
    original.teams[0].teamId = 'club:Z';
    original.teams[1].teamId = 'club:a';
    original.teams[0].players[0].playerId = 'player:Z';
    original.teams[0].players[1].playerId = 'player:a';
    const reordered = {
      ...original,
      teams: [...original.teams]
        .reverse()
        .map((team) => ({ ...team, players: [...team.players].reverse() })),
    };

    expect(calculateAflTradeHpnPavSeason(reordered)).toEqual(
      calculateAflTradeHpnPavSeason(original)
    );
  });

  it('rejects unsupported eras and incomplete league conservation', () => {
    expect(() => calculateAflTradeHpnPavSeason({ ...input(), seasonYear: 1997 })).toThrow(/1998/i);
    const unbalanced = input();
    unbalanced.teams[1].pointsAgainst = 99;
    expect(() => calculateAflTradeHpnPavSeason(unbalanced)).toThrow(/conserve/i);
  });

  it('fails closed when a team or component denominator is zero', () => {
    const noInside50s = input();
    noInside50s.teams[0].inside50sFor = 0;
    expect(() => calculateAflTradeHpnPavSeason(noInside50s)).toThrow(/inside 50/i);

    const noPlayerOffence = input();
    noPlayerOffence.teams[0].players = noPlayerOffence.teams[0].players.map((value) => ({
      ...value,
      totalPoints: 0,
      hitOuts: 0,
      goalAssists: 0,
      inside50s: 0,
      marksInside50: 0,
      freeKicksFor: 0,
      freeKicksAgainst: 0,
    }));
    expect(() => calculateAflTradeHpnPavSeason(noPlayerOffence)).toThrow(/offence score/i);

    const negativeDefence = input();
    negativeDefence.teams[0].players = negativeDefence.teams[0].players.map((value) => ({
      ...value,
      marksInside50: 1_000,
    }));
    expect(() => calculateAflTradeHpnPavSeason(negativeDefence)).toThrow(/defence score/i);
  });

  it('rejects partial rosters, duplicate evidence rows, and unconsumed finalized rows', () => {
    const partialRoster = input();
    partialRoster.teams[0].players.pop();
    expect(() => calculateAflTradeHpnPavSeason(partialRoster)).toThrow(/consumed exactly once/i);

    const forgedPartialRoster = input();
    const omittedRow = forgedPartialRoster.teams[0].players.pop()?.sourceRowIds[0];
    forgedPartialRoster.sourceSnapshots[0].sourceRowIds =
      forgedPartialRoster.sourceSnapshots[0].sourceRowIds.filter((rowId) => rowId !== omittedRow);
    expect(() => calculateAflTradeHpnPavSeason(forgedPartialRoster)).toThrow(
      /row-membership artifact/i
    );

    const duplicateEvidence = input();
    duplicateEvidence.sourceSnapshots[0].sourceRowIds.splice(
      1,
      0,
      duplicateEvidence.sourceSnapshots[0].sourceRowIds[0]
    );
    expect(() => calculateAflTradeHpnPavSeason(duplicateEvidence)).toThrow(/unique/i);

    const missingEvidence = input();
    missingEvidence.sourceSnapshots[0].sourceRowIds.pop();
    expect(() => calculateAflTradeHpnPavSeason(missingEvidence)).toThrow(/consumed exactly once/i);
  });

  it('rejects future, wrong-season, and mismatched retained evidence', () => {
    const futureSnapshot = input();
    futureSnapshot.sourceSnapshots[0].finalizedAt = '2026-08-11T00:00:00.000Z';
    expect(() => calculateAflTradeHpnPavSeason(futureSnapshot)).toThrow(/finalized/i);

    const wrongSeason = input();
    wrongSeason.sourceSnapshots[0].seasonYear = 2024;
    expect(() => calculateAflTradeHpnPavSeason(wrongSeason)).toThrow(/calculated season/i);

    const artifact = createAflTradeByteArtifactRef(
      methodBytes,
      'text/html',
      '2026-08-09T00:00:00.000Z'
    );
    expect(() =>
      createAflTradeHpnPavMethod({
        sourceArtifact: artifact,
        sourceBytes: new TextEncoder().encode('different bytes'),
        capturedAt: artifact.createdAt,
      })
    ).toThrow(/does not match/i);
  });
});
