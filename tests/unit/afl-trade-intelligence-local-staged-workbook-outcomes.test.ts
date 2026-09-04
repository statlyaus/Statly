import { describe, expect, it } from 'vitest';

import { loadLocalAflTradeStagedWorkbookOutcomes } from '@/server/aflTradeIntelligence/development/localStagedWorkbookOutcomeProjection';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const acquisitions = [
  {
    eventId: '2025_0016',
    year: 2025,
    category: 'trade' as const,
    acquisitionType: 'Trade',
    signing: null,
    pick: null,
    draftNumber: null,
    clubName: 'St Kilda',
    playerName: 'Sam Flanders',
    age: 24,
    heightCm: 183,
    weightKg: 82,
    originalClub: 'Gold Coast',
    grade: null,
    games: '0',
    goals: '0',
    coachesVotes: null,
    brownlowVotes: null,
    awards: null,
  },
  {
    eventId: '2020_0001',
    year: 2020,
    category: 'trade' as const,
    acquisitionType: 'Trade',
    signing: null,
    pick: null,
    draftNumber: null,
    clubName: 'Carlton',
    playerName: 'Player Mature',
    age: 25,
    heightCm: 190,
    weightKg: 90,
    originalClub: null,
    grade: null,
    games: null,
    goals: null,
    coachesVotes: null,
    brownlowVotes: null,
    awards: null,
  },
];

describe('local staged workbook outcome projection', () => {
  it('projects positive reviewed appearances and never turns missing source coverage into zero', async () => {
    let executedSql = '';
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql: string, parameters?: readonly unknown[]) {
        executedSql = sql;
        expect(parameters).toHaveLength(4);
        expect(parameters?.[0]).toContain('sam flanders');
        return {
          rows: [
            {
              normalized_player_name: 'sam flanders',
              normalized_club_name: 'st kilda',
              provider: 'official_afl',
              season_year: 2026,
              identity_count: 1,
              appearance_count: 12,
              exact_goals: 1,
              goals_complete: true,
              effective_through: '2026-05-28T09:30:00.000Z',
              source_through_season: 2026,
            },
            {
              normalized_player_name: 'player mature',
              normalized_club_name: 'carlton',
              provider: 'afl_tables',
              season_year: 2021,
              identity_count: 1,
              appearance_count: 40,
              exact_goals: null,
              goals_complete: false,
              effective_through: '2026-05-28T09:30:00.000Z',
              source_through_season: 2026,
            },
            {
              normalized_player_name: 'not requested',
              normalized_club_name: 'nowhere',
              provider: 'official_afl',
              season_year: 2026,
              identity_count: 1,
              appearance_count: 0,
              exact_goals: 0,
              goals_complete: true,
              effective_through: '2026-05-28T09:30:00.000Z',
              source_through_season: 2026,
            },
          ] as Row[],
          rowCount: 3,
        };
      },
      async transaction(work) {
        return work(this);
      },
    };

    const outcomes = await loadLocalAflTradeStagedWorkbookOutcomes(client, acquisitions);

    expect(executedSql).toContain("decision.subject_type='provider_identity_candidate'");
    expect(executedSql).toContain("decision.subject_type='provider_match_candidate'");
    expect(executedSql).toContain("decision.subject_type='local_reconciled_player_match_fact'");
    expect(executedSql).toContain('historical_review_health AS MATERIALIZED');
    expect(executedSql).toContain('historical_review_members AS MATERIALIZED');
    expect(executedSql).toContain("decision.evidence_json->>'evidenceSetSha256'=$2");
    expect(executedSql).toContain(
      "'local-afl-tables-review:identity:' || candidate.identity_candidate_id"
    );
    expect(executedSql).toContain(
      "'local-afl-tables-review:match:' || candidate.match_candidate_id"
    );
    expect(executedSql).toContain(
      "'local-afl-tables-review:fact:' || candidate.provider_decoded_row_id"
    );
    expect(executedSql).toContain('official_review_health AS MATERIALIZED');
    expect(executedSql).toContain("jsonb_array_length(review_set.evidence_json->'decisionIds')=36");
    expect(executedSql).toContain('count(DISTINCT expected.decision_id)=36');
    expect(executedSql).toContain('JOIN current_review_set review_set');
    expect(executedSql).toContain(
      'JOIN outcome_review_decision decision ON decision.decision_id=expected.decision_id'
    );
    expect(executedSql).toContain("review_set.decision_id='local-official-afl-review:set:' || $4");
    expect(executedSql).toContain("decision.subject_type='local_review_set'");
    expect(outcomes.get('2025_0016')).toEqual({
      source: 'reconciled_acquisition_spell',
      effectiveThrough: '2026-05-28T09:30:00.000Z',
      metrics: {
        games: {
          state: 'partial',
          observedValue: 12,
          reason: 'active_career_right_censored',
        },
        goals: {
          state: 'partial',
          observedValue: 1,
          reason: 'active_career_right_censored',
        },
        coachesVotes: { state: 'unavailable', reason: 'source_missing' },
        brownlowVotes: { state: 'unavailable', reason: 'source_missing' },
      },
    });
    expect(outcomes.get('2020_0001')?.metrics).toMatchObject({
      games: { state: 'observed', value: 40 },
      goals: { state: 'unavailable', reason: 'source_missing' },
    });
    expect(outcomes.has('not-requested')).toBe(false);
  });
});
