import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
  aflTradeValuationSourceQualificationReportSchema,
  createAflTradeValuationSourceQualificationReport,
} from '@/server/aflTradeIntelligence/valuation/valuationSourceQualificationReport';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-15T01:00:00.000Z',
  };
}

function reportContent() {
  return {
    schemaVersion: AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
    environment: 'non_production' as const,
    operation: 'valuation_model_training_and_derived_feature_creation' as const,
    valuationScopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    releaseTradeIds: ['trade-2025-a', 'trade-2025-b'],
    sourceRightsEvidenceRefs: [artifact('4'), artifact('5')],
    decision: {
      state: 'blocked' as const,
      blockers: [
        {
          code: 'source_blocked' as const,
          subject: { kind: 'source' as const, id: 'afl-tables-five-season' },
          evidenceRefs: [artifact('4')],
        },
      ],
    },
    evaluatedAt: '2026-08-15T02:00:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.' as const,
  };
}

describe('AFL trade valuation source qualification report', () => {
  it('content-addresses one exact-release blocked decision with complete source evidence', () => {
    const report = createAflTradeValuationSourceQualificationReport(reportContent());

    expect(report.qualificationReportId).toBe(
      createAflTradeContentAddress('valuation-source-qualification', report.content)
    );
    expect(aflTradeValuationSourceQualificationReportSchema.parse(report)).toEqual(report);
  });

  it('retains a durable eligible decision without describing model inputs as ready', () => {
    const report = createAflTradeValuationSourceQualificationReport({
      ...reportContent(),
      decision: { state: 'eligible_for_dataset_admission' as const },
    });

    expect(report.content.decision.state).toBe('eligible_for_dataset_admission');
    expect(report.content).not.toHaveProperty('ready');
    expect(report.content).not.toHaveProperty('modelRunId');
  });

  it('rejects blockers that do not cite one of the exact release source-rights artifacts', () => {
    expect(() =>
      createAflTradeValuationSourceQualificationReport({
        ...reportContent(),
        decision: {
          state: 'blocked' as const,
          blockers: [
            {
              code: 'source_blocked' as const,
              subject: { kind: 'source' as const, id: 'unrelated-source' },
              evidenceRefs: [artifact('6')],
            },
          ],
        },
      })
    ).toThrow();
  });
});
