import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION,
  createAflTradePrivateValuationFactualOutput,
  parseAflTradePrivateValuationFactualOutput,
} from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';

const sha = (character: string) => character.repeat(64);

function createFixture() {
  return createAflTradePrivateValuationFactualOutput({
    requestId: `private-valuation-dispatch:${sha('1')}`,
    valuationScopeKey: 'afl-men:2026-trades',
    captureBindingId: `private-valuation-capture-binding:${sha('2')}`,
    sourceAdmissionId: `private-valuation-source-admission:${sha('c')}`,
    normalizationRunId: `provider-normalization-run:${sha('3')}`,
    factBatch: {
      batchId: `source-fact-batch:${sha('4')}`,
      batchSha256: sha('4'),
    },
    reconciliation: {
      factualRunId: `factual-reconciliation-run:${sha('5')}`,
      runSha256: sha('5'),
      outputSetSha256: sha('6'),
      finalizedAt: '2026-08-24T09:04:00.000Z',
    },
    spellMetricBatches: [
      {
        batchId: `acquisition-spell-metric-batch:${sha('8')}`,
        batchSha256: sha('8'),
      },
      {
        batchId: `acquisition-spell-metric-batch:${sha('7')}`,
        batchSha256: sha('7'),
      },
    ],
    candidate: {
      candidateId: `factual-release-candidate:${sha('9')}`,
      candidateSha256: sha('9'),
      memberSetSha256: sha('a'),
    },
    factualRelease: {
      releaseId: `outcome-release:${sha('b')}`,
      releaseSha256: sha('b'),
    },
    preparedAt: '2026-08-24T09:05:00.000Z',
  });
}

describe('private valuation factual output', () => {
  it('content-addresses one exact non-production factual result for a dispatch', () => {
    const output = createFixture();

    expect(output.outputId).toMatch(/^private-valuation-factual-output:[a-f0-9]{64}$/);
    expect(parseAflTradePrivateValuationFactualOutput(output)).toEqual(output);
    expect(createFixture()).toEqual(output);
    expect(output.content).toMatchObject({
      valuationScopeKey: 'afl-men:2026-trades',
      sourceAdmissionId: `private-valuation-source-admission:${sha('c')}`,
      spellMetricBatches: [
        { batchId: `acquisition-spell-metric-batch:${sha('7')}` },
        { batchId: `acquisition-spell-metric-batch:${sha('8')}` },
      ],
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      limitation: AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION,
    });
  });

  it('rejects a recomputed output that claims another identifier', () => {
    const output = createFixture();

    expect(() =>
      parseAflTradePrivateValuationFactualOutput({
        ...output,
        outputId: `private-valuation-factual-output:${sha('c')}`,
      })
    ).toThrow('content address');
  });

  it('rejects duplicate spell-metric batch custody', () => {
    const output = createFixture();

    expect(() =>
      createAflTradePrivateValuationFactualOutput({
        ...output.content,
        spellMetricBatches: [output.content.spellMetricBatches[0]!, output.content.spellMetricBatches[0]!],
      })
    ).toThrow('unique');
  });
});
