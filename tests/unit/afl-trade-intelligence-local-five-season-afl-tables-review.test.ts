import { describe, expect, it } from 'vitest';

import {
  createLocalFiveSeasonAflTablesCorpusSha256,
  type LocalFiveSeasonAflTablesReviewRow,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';

function row(
  lineage: string,
  overrides: Partial<LocalFiveSeasonAflTablesReviewRow> = {}
): LocalFiveSeasonAflTablesReviewRow {
  return {
    capture_id: `capture:${lineage}`,
    normalization_run_id: `normalization:${lineage}`,
    season_year: 2024,
    provider_decoded_row_id: `decoded:${lineage}`,
    identity_candidate_id: `identity:${lineage}`,
    identity_candidate_sha256: lineage.repeat(64).slice(0, 64),
    native_entity_id: '12345',
    recorded_name: 'Reviewed Player',
    recorded_club_name: 'Reviewed Club',
    match_candidate_id: `match:${lineage}`,
    match_candidate_sha256: lineage.repeat(64).slice(0, 64),
    order_independent_sha256: 'a'.repeat(64),
    match_date_text: '2024-05-04',
    definition_version: 'goals/v1',
    availability: 'exact',
    numeric_value: 2,
    missing_reason: null,
    source_field: 'Goals',
    ...overrides,
  };
}

describe('local five-season AFL Tables review corpus', () => {
  it('is stable across fresh custody lineage but changes with source semantics', () => {
    const first = createLocalFiveSeasonAflTablesCorpusSha256([row('a')]);
    const replay = createLocalFiveSeasonAflTablesCorpusSha256([row('b')]);
    const changed = createLocalFiveSeasonAflTablesCorpusSha256([row('c', { numeric_value: 3 })]);

    expect(replay).toBe(first);
    expect(changed).not.toBe(first);
  });
});
