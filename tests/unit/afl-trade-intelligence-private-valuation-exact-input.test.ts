import { describe, expect, it } from 'vitest';

import { createAflTradeAdmittedPlayerFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import { loadAflTradePrivateValuationModelPairExactInput } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = 'a'.repeat(64);
const id = (prefix: string) => `${prefix}:${sha}`;
const factual = createAflTradeAdmittedPlayerFactualOutput({
  requestId: id('private-valuation-dispatch'),
  valuationScopeKey: 'afl-men:2025-trades',
  admittedPlayerDataset: { datasetId: id('dataset'), admissionId: id('dataset-admission') },
  sourceCaptures: [
    {
      captureId: id('source-capture'),
      sourceSnapshotId: id('source-snapshot'),
      consumedFieldSetId: id('consumed-field-set'),
      consumedFieldSetSha256: sha,
    },
  ],
  spellMetricBatches: [{ batchId: id('acquisition-spell-metric-batch'), batchSha256: sha }],
  candidate: {
    candidateId: id('factual-release-candidate'),
    candidateSha256: sha,
    memberSetSha256: sha,
  },
  factualRelease: { releaseId: id('outcome-release'), releaseSha256: sha },
  preparedAt: '2026-08-12T00:02:00.000Z',
});

describe('exact admitted-player model input loading', () => {
  it('rejects a substituted player dataset before accepting calculation input', async () => {
    const client: AflOutcomeSqlClient = {
      async query<Row>() {
        return {
          rows: [
            {
              scope_key: 'afl-men:2025-trades',
              output_json: factual,
              calculation_json: null,
              hpn_values_sha256: sha,
            },
          ] as Row[],
          rowCount: 1,
        };
      },
      async transaction(work) {
        return work(client);
      },
    };
    await expect(
      loadAflTradePrivateValuationModelPairExactInput({
        client,
        prepared: {
          state: 'prepared',
          requestId: factual.content.requestId,
          factualOutputId: factual.outputId,
          inputSetId: id('hpn-pav-input-set'),
          calculationId: id('hpn-pav-season'),
          captureBindingIds: [],
          sourceAdmissionIds: [],
          publicationEligible: false,
        },
        targets: {
          player: {
            modelId: 'player',
            modelVersion: '1',
            protocolId: id('model-protocol'),
            datasetId: `dataset:${'b'.repeat(64)}`,
            datasetAdmissionId: id('dataset-admission'),
          },
          pick: {
            protocolId: id('model-protocol'),
            datasetId: id('dataset'),
            datasetAdmissionId: id('dataset-admission'),
            policyId: id('pick-pav-policy'),
          },
          qualificationPolicyId: id('model-qualification-policy'),
        },
      })
    ).rejects.toThrow(
      'Exact admitted-player model targets differ from the retained factual parent.'
    );
  });
});
