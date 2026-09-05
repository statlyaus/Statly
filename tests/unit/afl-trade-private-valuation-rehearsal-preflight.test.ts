import { describe, expect, it, vi } from 'vitest';

import { inspectExact2025AflPrivateValuationRehearsalPreflight } from '@/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';

describe('exact 2025 AFL private valuation rehearsal preflight', () => {
  it('reports retained derived authority without treating it as genuine source admission', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows: [
        {
          private_factual_present: true,
          private_factual_revision: 2,
          qualified_model_present: true,
          qualified_model_revision: 4,
          prepared_v3_present: true,
          prepared_v3_revision: 3,
          private_batch_present: true,
          private_batch_revision: 5,
          trade_count: 12,
          ready_count: 11,
          unavailable_count: 1,
        },
      ],
    }));

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight({ query });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(['afl-men:2025-trades']);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu);
    expect(report).toEqual({
      schemaVersion: 'afl-private-valuation-rehearsal-preflight/v1',
      scopeKey: 'afl-men:2025-trades',
      competitionCode: 'AFLM',
      season: 2025,
      inspectionMode: 'read_only',
      state: 'blocked',
      publicationEligible: false,
      sourceAuthority: {
        genuineDraftTrade: 'not_locally_admitted',
        genuineHpnCorroboration: 'not_locally_admitted',
      },
      retainedAuthority: {
        privateFactualHead: { present: true, revision: 2 },
        qualifiedModelEvidence: { present: true, revision: 4 },
        preparedV3: { present: true, revision: 3 },
        exhaustivePrivateBatch: {
          present: true,
          revision: 5,
          tradeCount: 12,
          readyCount: 11,
          unavailableCount: 1,
        },
      },
      blockerCodes: [
        'genuine_draft_trade_authority_not_locally_admitted',
        'genuine_hpn_corroborating_authority_not_locally_admitted',
      ],
    });
  });

  it('names every missing retained stage on an empty migrated database', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows: [
        {
          private_factual_present: false,
          private_factual_revision: null,
          qualified_model_present: false,
          qualified_model_revision: null,
          prepared_v3_present: false,
          prepared_v3_revision: null,
          private_batch_present: false,
          private_batch_revision: null,
          trade_count: null,
          ready_count: null,
          unavailable_count: null,
        },
      ],
    }));

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight({ query });

    expect(report.retainedAuthority.exhaustivePrivateBatch).toEqual({
      present: false,
      revision: null,
      tradeCount: null,
      readyCount: null,
      unavailableCount: null,
    });
    expect(report.blockerCodes).toEqual([
      'genuine_draft_trade_authority_not_locally_admitted',
      'genuine_hpn_corroborating_authority_not_locally_admitted',
      'current_private_factual_head_missing',
      'qualified_model_evidence_missing',
      'prepared_v3_head_missing',
      'exhaustive_private_batch_head_missing',
    ]);
  });
});
