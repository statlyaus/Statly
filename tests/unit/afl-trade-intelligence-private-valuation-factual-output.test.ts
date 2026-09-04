import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION,
  createAflTradeAdmittedPlayerFactualOutput,
  createAflTradePrivateValuationFactualOutput,
  doesAflTradePlayerModelFactualAuthorityMatch,
  parseAflTradeAdmittedPlayerFactualOutput,
  parseAflTradePlayerModelFactualOutput,
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
  it('content-addresses one exact multi-capture admitted-player factual result', () => {
    const output = createAflTradeAdmittedPlayerFactualOutput({
      requestId: `private-valuation-dispatch:${sha('1')}`,
      valuationScopeKey: 'afl-men:genuine-player-contribution:2021-2024',
      admittedPlayerDataset: {
        datasetId: `dataset:${sha('2')}`,
        admissionId: `dataset-admission:${sha('3')}`,
      },
      sourceCaptures: [
        {
          captureId: `source-capture:${sha('8')}`,
          sourceSnapshotId: `source-snapshot:${sha('9')}`,
          consumedFieldSetId: `consumed-field-set:${sha('a')}`,
          consumedFieldSetSha256: sha('b'),
        },
        {
          captureId: `source-capture:${sha('4')}`,
          sourceSnapshotId: `source-snapshot:${sha('5')}`,
          consumedFieldSetId: `consumed-field-set:${sha('6')}`,
          consumedFieldSetSha256: sha('7'),
        },
      ],
      spellMetricBatches: [
        {
          batchId: `acquisition-spell-metric-batch:${sha('d')}`,
          batchSha256: sha('d'),
        },
      ],
      candidate: {
        candidateId: `factual-release-candidate:${sha('e')}`,
        candidateSha256: sha('e'),
        memberSetSha256: sha('f'),
      },
      factualRelease: {
        releaseId: `outcome-release:${sha('0')}`,
        releaseSha256: sha('0'),
      },
      preparedAt: '2026-09-03T12:30:00.000Z',
    });

    expect(parseAflTradeAdmittedPlayerFactualOutput(output)).toEqual(output);
    expect(output.content).toMatchObject({
      schemaVersion: 'afl-trade-private-valuation-factual-output/v2',
      sourceCaptures: [
        { captureId: `source-capture:${sha('4')}` },
        { captureId: `source-capture:${sha('8')}` },
      ],
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

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

  it('accepts either authenticated factual contract at the player-model boundary', () => {
    const currentFactual = createFixture();
    const admittedFactual = createAflTradeAdmittedPlayerFactualOutput({
      requestId: currentFactual.content.requestId,
      valuationScopeKey: currentFactual.content.valuationScopeKey,
      admittedPlayerDataset: {
        datasetId: `dataset:${sha('2')}`,
        admissionId: `dataset-admission:${sha('3')}`,
      },
      sourceCaptures: [
        {
          captureId: `source-capture:${sha('4')}`,
          sourceSnapshotId: `source-snapshot:${sha('5')}`,
          consumedFieldSetId: `consumed-field-set:${sha('6')}`,
          consumedFieldSetSha256: sha('7'),
        },
      ],
      spellMetricBatches: currentFactual.content.spellMetricBatches,
      candidate: currentFactual.content.candidate,
      factualRelease: currentFactual.content.factualRelease,
      preparedAt: currentFactual.content.preparedAt,
    });

    expect(parseAflTradePlayerModelFactualOutput(currentFactual)).toEqual(currentFactual);
    expect(parseAflTradePlayerModelFactualOutput(admittedFactual)).toEqual(admittedFactual);
  });

  it('accepts current factual v1 only through an exact dataset and admission parent', () => {
    const factual = createFixture();
    const authority = {
      factual,
      requestId: factual.content.requestId,
      outputId: factual.outputId,
      valuationScopeKey: factual.content.valuationScopeKey,
      factualValuesSha256: factual.content.candidate.memberSetSha256,
      target: {
        datasetId: `dataset:${sha('1')}`,
        admissionId: `dataset-admission:${sha('2')}`,
      },
      dataset: {
        datasetId: `dataset:${sha('1')}`,
        factualReleaseId: factual.content.factualRelease.releaseId,
        factualCandidateId: factual.content.candidate.candidateId,
        sourceMemberSetSha256: factual.content.candidate.memberSetSha256,
      },
      admission: {
        admissionId: `dataset-admission:${sha('2')}`,
        factualReleaseId: factual.content.factualRelease.releaseId,
        factualCandidateId: factual.content.candidate.candidateId,
        sourceMemberSetSha256: factual.content.candidate.memberSetSha256,
      },
      admittedSources: [
        {
          captureId: `source-capture:${sha('3')}`,
          sourceSnapshotId: `source-snapshot:${sha('4')}`,
          consumedFieldSetId: `consumed-field-set:${sha('5')}`,
          consumedFieldSetSha256: sha('6'),
        },
      ],
      legacySourceCapture: {
        captureId: `source-capture:${sha('3')}`,
        sourceSnapshotId: `source-snapshot:${sha('4')}`,
      },
    } as const;

    expect(doesAflTradePlayerModelFactualAuthorityMatch(authority)).toBe(true);
    expect(
      doesAflTradePlayerModelFactualAuthorityMatch({
        ...authority,
        admission: { ...authority.admission, sourceMemberSetSha256: sha('f') },
      })
    ).toBe(false);
    expect(
      doesAflTradePlayerModelFactualAuthorityMatch({
        ...authority,
        target: { ...authority.target, admissionId: `dataset-admission:${sha('f')}` },
      })
    ).toBe(false);
    expect(
      doesAflTradePlayerModelFactualAuthorityMatch({
        ...authority,
        legacySourceCapture: {
          ...authority.legacySourceCapture,
          sourceSnapshotId: `source-snapshot:${sha('f')}`,
        },
      })
    ).toBe(false);
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
        spellMetricBatches: [
          output.content.spellMetricBatches[0]!,
          output.content.spellMetricBatches[0]!,
        ],
      })
    ).toThrow('unique');
  });
});
