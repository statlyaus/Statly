import { describe, expect, it } from 'vitest';

import { selectAflTradeModelConsumedSourceFields } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetFactualLineageRepository';

describe('valuation dataset factual source lineage', () => {
  it('selects only fields authorized for both feature derivation and model training', () => {
    expect(
      selectAflTradeModelConsumedSourceFields([
        { sourceField: 'Player.Name', use: 'archive_fact' },
        { sourceField: 'Player.Name', use: 'derived_feature' },
        { sourceField: 'Coaches.Votes', use: 'archive_fact' },
        { sourceField: 'Coaches.Votes', use: 'derived_feature' },
        { sourceField: 'Coaches.Votes', use: 'model_training' },
        { sourceField: 'Goals', use: 'model_training' },
        { sourceField: 'Goals', use: 'derived_feature' },
      ])
    ).toEqual(['Coaches.Votes', 'Goals']);
  });
});
