import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
  createAflTradePreparedValuationInputSet,
} from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';

const digest = (character: string) => character.repeat(64);
type PreparedInput = Parameters<typeof createAflTradePreparedValuationInputSet>[0];

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 256,
    createdAt: '2026-08-15T01:00:00.000Z',
  };
}

function content() {
  return {
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
    environment: 'non_production' as const,
    scopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    preparationAuthority: 'source_policy_preflight_only' as const,
    qualificationOperation:
      'valuation_model_training_and_derived_feature_creation' as const,
    qualificationReportId: `valuation-source-qualification:${digest('4')}`,
    qualificationReportArtifact: artifact('5'),
    sourceQualificationEvidenceRefs: [artifact('6'), artifact('8')],
    releaseTradeIds: ['trade-a', 'trade-b'],
    entries: [
      {
        tradeId: 'trade-a',
        state: 'blocked' as const,
        blockers: [
          {
            code: 'source_blocked' as const,
            subject: { kind: 'source' as const, id: 'official-afl-2026' },
            evidenceRefs: [artifact('6')],
          },
        ],
      },
      {
        tradeId: 'trade-b',
        state: 'blocked' as const,
        blockers: [
          {
            code: 'source_blocked' as const,
            subject: { kind: 'source' as const, id: 'afl-tables-five-season' },
            evidenceRefs: [artifact('8')],
          },
        ],
      },
    ],
    tradeCount: 2,
    readyCount: 0,
    blockedCount: 2,
    preparedAt: '2026-08-15T02:00:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.' as const,
  };
}

describe('AFL trade prepared valuation input set', () => {
  it('classifies every factual-release trade exactly once as blocked preflight evidence', () => {
    const prepared = createAflTradePreparedValuationInputSet(content());

    expect(prepared.preparedInputSetId).toBe(
      createAflTradeContentAddress('prepared-valuation-input-set', prepared.content)
    );
    expect(prepared.content.entries.map(({ state }) => state)).toEqual(['blocked', 'blocked']);
    expect(prepared.content.qualificationOperation).toBe(
      'valuation_model_training_and_derived_feature_creation'
    );
    expect(prepared.content.readyCount + prepared.content.blockedCount).toBe(
      prepared.content.tradeCount
    );
  });

  it('fails closed when a release trade is omitted from classification', () => {
    const incomplete = content();
    incomplete.entries = incomplete.entries.slice(0, 1);
    incomplete.blockedCount = 0;

    expect(() => createAflTradePreparedValuationInputSet(incomplete)).toThrow(
      'Prepared entries must classify the exact factual-release trade set.'
    );
  });

  it('rejects an invented ready value where only blocker evidence exists', () => {
    const inconsistent = {
      ...content(),
      entries: [
        content().entries[0],
        {
          tradeId: 'trade-b',
          state: 'ready',
          calculationInputArtifact: artifact('7'),
          inputTraceArtifact: artifact('8'),
        },
      ],
      readyCount: 1,
      blockedCount: 1,
    } as unknown as PreparedInput;

    expect(() => createAflTradePreparedValuationInputSet(inconsistent)).toThrow(
      'cannot assert model-ready trade inputs'
    );
  });

  it('rejects production use of the local preflight contract', () => {
    expect(() =>
      createAflTradePreparedValuationInputSet({
        ...content(),
        environment: 'production',
      } as unknown as PreparedInput)
    ).toThrow();
  });

  it('rejects model blockers from the source-policy-only v1 contract', () => {
    const invalid = structuredClone(content()) as unknown as {
      entries: { blockers: { code: string }[] }[];
    };
    invalid.entries[0]!.blockers[0]!.code = 'model_not_approved';

    expect(() =>
      createAflTradePreparedValuationInputSet(invalid as unknown as PreparedInput)
    ).toThrow(
      'accepts only exact source-policy blockers'
    );
  });
});
