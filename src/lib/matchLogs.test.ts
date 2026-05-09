import { describe, expect, it } from 'vitest';

import {
  buildEmptyMatchLogStageSnapshot,
  buildMatchLogEntityKey,
  buildMatchLogStageSnapshot,
  classifyMatchLogReconciliationIssues,
  dedupeByDateOpponent,
  normalizeMatchLogStatValue,
} from './matchLogs';

describe('buildMatchLogEntityKey', () => {
  it('prefers canonical player and match identity when both are available', () => {
    expect(
      buildMatchLogEntityKey({
        season: 2026,
        roundNumber: 4,
        playerId: 'adam_saad',
        matchId: '2026-R4-CAR-COL',
        playerName: 'Adam Saad',
        opponent: 'Collingwood',
      })
    ).toBe('match|2026_r4_car_col|player_id|adam_saad');
  });

  it('normalizes player and opponent names into a stable reconciliation key', () => {
    expect(
      buildMatchLogEntityKey({
        season: 2026,
        roundNumber: 4,
        playerName: 'Adam Saad',
        opponent: 'Greater Western Sydney',
      })
    ).toBe('2026|4|adam_saad|greater_western_sydney');
  });
});

describe('buildMatchLogStageSnapshot', () => {
  it('preserves unknown nullable advanced stats as null while keeping core stats numeric', () => {
    const snapshot = buildMatchLogStageSnapshot({
      disposals: 17,
      disposalEffPct: null,
    });

    expect(snapshot.disposals).toEqual({
      present: true,
      value: 17,
      provenance: null,
    });
    expect(snapshot.disposalEffPct).toEqual({
      present: false,
      value: null,
      provenance: null,
    });
    expect(snapshot.goals).toEqual({
      present: false,
      value: 0,
      provenance: null,
    });
  });
});

describe('normalizeMatchLogStatValue', () => {
  it('preserves unknown nullable stat values as null', () => {
    expect(normalizeMatchLogStatValue('disposalEffPct', null)).toBeNull();
    expect(normalizeMatchLogStatValue('metresGained', undefined)).toBeNull();
    expect(normalizeMatchLogStatValue('scoreInvolvements', Number.NaN)).toBeNull();
    expect(normalizeMatchLogStatValue('timeOnGroundPct', 'unknown')).toBeNull();
  });

  it('normalizes unknown non-nullable stat values to zero', () => {
    expect(normalizeMatchLogStatValue('kicks', null)).toBe(0);
    expect(normalizeMatchLogStatValue('goals', undefined)).toBe(0);
    expect(normalizeMatchLogStatValue('disposals', Number.NaN)).toBe(0);
    expect(normalizeMatchLogStatValue('marks', 'unknown')).toBe(0);
  });

  it('preserves finite numeric and numeric-string values', () => {
    expect(normalizeMatchLogStatValue('disposalEffPct', 72.5)).toBe(72.5);
    expect(normalizeMatchLogStatValue('metresGained', '318')).toBe(318);
    expect(normalizeMatchLogStatValue('kicks', 11)).toBe(11);
    expect(normalizeMatchLogStatValue('goals', '2')).toBe(2);
  });
});

describe('classifyMatchLogReconciliationIssues', () => {
  it('flags presence, value, and provenance drift across stages', () => {
    const stages = {
      merged: buildMatchLogStageSnapshot(
        {
          disposals: 20,
          disposalEffPct: 75,
        },
        {
          provenance: {
            disposals: 'afltables',
            disposalEffPct: 'footywire_match',
          },
        }
      ),
      raw: buildMatchLogStageSnapshot(
        {
          disposals: 18,
          disposalEffPct: 75,
        },
        {
          provenance: {
            disposals: 'fryzigg',
            disposalEffPct: 'footywire_match',
          },
        }
      ),
      projection: buildMatchLogStageSnapshot({
        disposals: 18,
      }),
      api: buildEmptyMatchLogStageSnapshot(),
    };

    const issues = classifyMatchLogReconciliationIssues(stages);
    const issueCodes = issues.map((issue) => `${issue.code}:${issue.statKey}`);

    expect(issueCodes).toContain('raw_value_mismatch:disposals');
    expect(issueCodes).toContain('raw_provenance_mismatch:disposals');
    expect(issueCodes).toContain('projection_presence_mismatch:disposalEffPct');
    expect(issueCodes).toContain('dropped_in_projection:disposalEffPct');
    expect(issueCodes).toContain('api_presence_mismatch:disposals');
    expect(issueCodes).toContain('dropped_in_api:disposals');
  });

  it('flags downstream data that appears without authoritative merged coverage', () => {
    const stages = {
      merged: buildEmptyMatchLogStageSnapshot(),
      raw: buildMatchLogStageSnapshot({
        intercepts: 3,
      }),
      projection: buildEmptyMatchLogStageSnapshot(),
      api: buildEmptyMatchLogStageSnapshot(),
    };

    const issues = classifyMatchLogReconciliationIssues(stages);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'downstream_without_merged',
          statKey: 'intercepts',
        }),
        expect.objectContaining({
          code: 'raw_presence_mismatch',
          statKey: 'intercepts',
        }),
      ])
    );
  });

  it('does not emit API-stage mismatches when the API stage is not populated', () => {
    const stages = {
      merged: buildMatchLogStageSnapshot({ disposals: 20 }),
      raw: buildMatchLogStageSnapshot({ disposals: 20 }),
      projection: buildMatchLogStageSnapshot({ disposals: 20 }),
      api: buildEmptyMatchLogStageSnapshot(),
    };

    const issues = classifyMatchLogReconciliationIssues(stages, {
      populatedStages: { merged: true, raw: true, projection: true, api: false },
    });

    expect(issues.map((issue) => issue.code)).not.toContain('dropped_in_api');
    expect(issues.map((issue) => issue.code)).not.toContain('api_presence_mismatch');
  });

  it('does not treat downstream-enriched stats as projection presence drift', () => {
    const stages = {
      merged: buildEmptyMatchLogStageSnapshot(),
      raw: buildEmptyMatchLogStageSnapshot(),
      projection: buildMatchLogStageSnapshot({ timeOnGroundPct: 82 }, {
        availability: { timeOnGroundPct: true },
      }),
      api: buildEmptyMatchLogStageSnapshot(),
    };

    const issues = classifyMatchLogReconciliationIssues(stages, {
      populatedStages: { merged: true, raw: true, projection: true, api: false },
    });

    expect(issues.map((issue) => `${issue.code}:${issue.statKey}`)).not.toContain(
      'projection_presence_mismatch:timeOnGroundPct'
    );
    expect(issues.map((issue) => `${issue.code}:${issue.statKey}`)).not.toContain(
      'downstream_without_merged:timeOnGroundPct'
    );
  });
});

describe('dedupeByDateOpponent', () => {
  it('keeps canonical match rows even when the date field is blank', () => {
    const rows = dedupeByDateOpponent([
      {
        matchId: '2026-R1-CAR-RIC',
        season: 2026,
        roundNumber: 1,
        date: '',
        opponent: 'Richmond',
        stats: {
          behinds: 0,
          kicks: 4,
          handballs: 4,
          disposals: 8,
          marks: 2,
          tackles: 1,
          goals: 0,
          hitouts: 0,
          clearances: 0,
          inside50s: 0,
          rebound50s: 0,
          clangers: 0,
          contestedPossessions: null,
          uncontestedPossessions: null,
          freesFor: null,
          freesAgainst: null,
          onePercenters: null,
          goalAssists: null,
          turnovers: null,
          intercepts: null,
          metresGained: null,
          contestedMarks: null,
          effectiveDisposals: null,
          scoreInvolvements: null,
          timeOnGroundPct: null,
          disposalEffPct: null,
          minutes: null,
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      matchId: '2026-R1-CAR-RIC',
      season: 2026,
      roundNumber: 1,
      opponent: 'Richmond',
    });
  });
});
