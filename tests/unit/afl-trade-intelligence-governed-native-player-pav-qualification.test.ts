import { beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { evaluateAflTradeAdmittedPlayerPavFinal } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavFinalEvaluation';
import { aflTradeNativePavFinalEvidenceSchema } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavReports';
import {
  createGovernedNativePlayerPavQualificationCriteria,
  deriveGovernedNativePlayerPavQualificationEvidence,
  governedNativePlayerPavQualificationEvidenceSchema,
} from '@/server/aflTradeIntelligence/valuation/internal/governedNativePlayerPavQualification';

import { nativePavFinalEvidenceFixture } from '../testUtils/nativePavFinalEvidenceFixture';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

type Source = Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
type Parents = ReturnType<typeof nativePavFinalEvidenceFixture>;
type FinalEvidence = ReturnType<typeof evaluateAflTradeAdmittedPlayerPavFinal>;

let source: Source;
let parents: Parents;
let finalEvidence: FinalEvidence;
let configuration: unknown;

beforeAll(async () => {
  source = await nativePavModelRunSqlFixture();
  parents = nativePavFinalEvidenceFixture(source);
  finalEvidence = evaluateAflTradeAdmittedPlayerPavFinal(parents);
  configuration = JSON.parse(new TextDecoder().decode(parents.calibrationConfigurationBytes));
}, 120_000);

function derive(final: unknown = finalEvidence) {
  const parsed = aflTradeNativePavFinalEvidenceSchema.parse(final);
  const baseline = parsed.content.baselineComparisons[0]!;
  const criteria = createGovernedNativePlayerPavQualificationCriteria({
    selectedBaselineDefinitionArtifact: baseline.definitionArtifact,
  });
  return deriveGovernedNativePlayerPavQualificationEvidence({
    finalEvidence: parsed,
    finalEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(parsed, source.startedAt),
    calibrationConfiguration: configuration,
    calibrationConfigurationArtifact: parents.calibrationConfigurationArtifact,
    criteria,
    criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(criteria, source.startedAt),
  });
}

function withCompleteDistributionSupport() {
  const content = structuredClone(finalEvidence.content);
  if (content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2') {
    throw new Error('Expected V2 final evidence.');
  }
  for (const comparison of content.baselineComparisons) {
    for (const row of comparison.pairedScores) {
      for (const score of [
        ...row.primary.annual,
        row.primary.cumulative,
        ...row.baseline.annual,
        row.baseline.cumulative,
      ]) {
        score.distribution ??= {
          crps: score.absoluteError,
          intervalCoverage: 0,
          intervalWidth: 0,
          intervalScore: score.absoluteError,
        };
      }
    }
    for (const [side, metrics] of [
      ['primary', comparison.primaryMetrics],
      ['baseline', comparison.baselineMetrics],
    ] as const) {
      for (const [index, metric] of metrics.annual.entries()) {
        if (metric === null) throw new Error('Expected annual paired metrics.');
        const distributions = comparison.pairedScores.map(
          (row) => row[side].annual[index]!.distribution!
        );
        metric.distributionObservationCount = distributions.length;
        metric.crps =
          distributions.reduce((sum, distribution) => sum + distribution.crps, 0) /
          distributions.length;
        metric.intervalCoverage =
          distributions.reduce((sum, distribution) => sum + distribution.intervalCoverage, 0) /
          distributions.length;
        metric.intervalWidth =
          distributions.reduce((sum, distribution) => sum + distribution.intervalWidth, 0) /
          distributions.length;
        metric.intervalScore =
          distributions.reduce((sum, distribution) => sum + distribution.intervalScore, 0) /
          distributions.length;
      }
      if (metrics.cumulative === null) throw new Error('Expected cumulative paired metrics.');
      const distributions = comparison.pairedScores.map(
        (row) => row[side].cumulative.distribution!
      );
      metrics.cumulative.distributionObservationCount = distributions.length;
      metrics.cumulative.crps =
        distributions.reduce((sum, distribution) => sum + distribution.crps, 0) /
        distributions.length;
      metrics.cumulative.intervalCoverage =
        distributions.reduce((sum, distribution) => sum + distribution.intervalCoverage, 0) /
        distributions.length;
      metrics.cumulative.intervalWidth =
        distributions.reduce((sum, distribution) => sum + distribution.intervalWidth, 0) /
        distributions.length;
      metrics.cumulative.intervalScore =
        distributions.reduce((sum, distribution) => sum + distribution.intervalScore, 0) /
        distributions.length;
    }
  }
  return aflTradeNativePavFinalEvidenceSchema.parse({
    evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
    content,
  });
}

describe('governed native player-PAV qualification evidence', () => {
  it('derives exact point evidence but remains inconclusive without simultaneous precision', () => {
    const complete = withCompleteDistributionSupport();
    const evidence = derive(complete);
    if (complete.content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2') {
      throw new Error('Expected V2 final evidence.');
    }
    const comparison = complete.content.baselineComparisons[0]!;
    const expectedPrimaryCrps =
      comparison.pairedScores.reduce(
        (sum, row) => sum + row.primary.cumulative.distribution!.crps,
        0
      ) / comparison.pairedScores.length;

    expect(evidence.evidenceId).toMatch(/^native-player-pav-qualification-evidence:[a-f0-9]{64}$/u);
    expect(evidence.content).toMatchObject({
      authorityBoundary: 'authenticated_inconclusive_no_qualification_authority',
      finalEvaluationId: complete.evaluationId,
      nominalIntervalCoverage: 0.8,
      support: {
        status: 'complete_common_distribution_support',
        pairedObservationIds: comparison.pairedObservationIds,
        excludedObservationIds: comparison.excludedObservationIds,
        missingDistributionObservationIds: [],
      },
      assessment: { status: 'inconclusive', precisionMethodReference: null },
      qualificationGranted: false,
    });
    expect(evidence.content.acceptanceInput.cumulativeCrps?.candidate).toBeCloseTo(
      expectedPrimaryCrps,
      12
    );
    expect(evidence.content.assessment.criteria).toHaveLength(9);
    expect(evidence.content.assessment.criteria.every(({ status }) => status !== 'pass')).toBe(
      true
    );
  });

  it('preserves incomplete common distribution support without dropping observations', () => {
    if (finalEvidence.content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2') {
      throw new Error('Expected V2 final evidence.');
    }
    const comparison = finalEvidence.content.baselineComparisons[0]!;
    const missingDistributionObservationIds = comparison.pairedScores
      .filter((row) =>
        [
          ...row.primary.annual,
          row.primary.cumulative,
          ...row.baseline.annual,
          row.baseline.cumulative,
        ].some(({ distribution }) => distribution === null)
      )
      .map(({ observationId }) => observationId);
    const evidence = derive();

    expect(evidence.content.support).toMatchObject({
      status: 'incomplete_distribution_support',
      pairedObservationIds: comparison.pairedObservationIds,
      missingDistributionObservationIds,
    });
    expect(evidence.content.acceptanceInput.cumulativeCrps).toBeNull();
    expect(
      evidence.content.acceptanceInput.horizons.every(({ coverage }) => coverage === null)
    ).toBe(true);
    expect(evidence.content.acceptanceInput.horizons.every(({ mae }) => mae !== null)).toBe(true);
    expect(evidence.content.assessment.status).toBe('inconclusive');
  });

  it('rejects V1 evidence, an unselected baseline and unauthenticated criteria', () => {
    const content = {
      ...finalEvidence.content,
      schemaVersion: 'afl-trade-native-pav-final-evaluation/v1' as const,
      baselineComparisons: finalEvidence.content.baselineComparisons.map(
        ({ pairedScores: _pairedScores, ...comparison }) => comparison
      ),
    };
    const v1 = aflTradeNativePavFinalEvidenceSchema.parse({
      evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
      content,
    });
    expect(() => derive(v1)).toThrow(/V5|parents|coverage/i);

    const wrongBaseline = createAflTradeCanonicalJsonArtifactRef(
      { fixture: 'unselected baseline' },
      source.startedAt
    );
    const criteria = createGovernedNativePlayerPavQualificationCriteria({
      selectedBaselineDefinitionArtifact: wrongBaseline,
    });
    expect(() =>
      deriveGovernedNativePlayerPavQualificationEvidence({
        finalEvidence,
        finalEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          finalEvidence,
          source.startedAt
        ),
        calibrationConfiguration: configuration,
        calibrationConfigurationArtifact: parents.calibrationConfigurationArtifact,
        criteria,
        criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(criteria, source.startedAt),
      })
    ).toThrow(/selected baseline/i);

    expect(() =>
      deriveGovernedNativePlayerPavQualificationEvidence({
        finalEvidence,
        finalEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          finalEvidence,
          source.startedAt
        ),
        calibrationConfiguration: configuration,
        calibrationConfigurationArtifact: parents.calibrationConfigurationArtifact,
        criteria: createGovernedNativePlayerPavQualificationCriteria({
          selectedBaselineDefinitionArtifact:
            finalEvidence.content.baselineComparisons[0]!.definitionArtifact,
        }),
        criteriaArtifact: wrongBaseline,
      })
    ).toThrow(/parents|coverage/i);
  });

  it('rejects resealed assessment and precision substitutions', () => {
    const evidence = derive(withCompleteDistributionSupport());
    const alteredAssessmentContent = structuredClone(evidence.content);
    alteredAssessmentContent.assessment.criteria[0]!.status = 'pass';
    expect(() =>
      governedNativePlayerPavQualificationEvidenceSchema.parse({
        evidenceId: createAflTradeContentAddress(
          'native-player-pav-qualification-evidence',
          alteredAssessmentContent
        ),
        content: alteredAssessmentContent,
      })
    ).toThrow(/recomputation|assessment/i);

    const alteredPrecisionContent = structuredClone(evidence.content);
    alteredPrecisionContent.acceptanceInput.precision = {
      jointConfidence: 0.95,
      scope: 'simultaneous_all_nine_criteria',
      methodReference: createAflTradeContentAddress('artifact', {
        fixture: 'unreviewed precision',
      }),
      improvement: { lower: 0.05, upper: 1 },
      horizons: alteredPrecisionContent.acceptanceInput.horizons.map(({ horizon }) => ({
        horizon,
        coverage: { lower: 0.75, upper: 0.85 },
        maeRatio: { lower: 0, upper: 1.05 },
      })),
    };
    expect(() =>
      governedNativePlayerPavQualificationEvidenceSchema.parse({
        evidenceId: createAflTradeContentAddress(
          'native-player-pav-qualification-evidence',
          alteredPrecisionContent
        ),
        content: alteredPrecisionContent,
      })
    ).toThrow(/precision/i);
  });

  it('rejects resealed paired-score and support contradictions', () => {
    const alteredScores = structuredClone(finalEvidence.content);
    if (alteredScores.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2') {
      throw new Error('Expected V2 final evidence.');
    }
    alteredScores.baselineComparisons[0]!.pairedScores[0]!.primary.annual[0]!.absoluteError += 1;
    const resealedScores = aflTradeNativePavFinalEvidenceSchema.parse({
      evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', alteredScores),
      content: alteredScores,
    });
    expect(() => derive(resealedScores)).toThrow(/comparison metrics|paired support/i);

    const completeEvidence = derive(withCompleteDistributionSupport());
    const emptySupport = structuredClone(completeEvidence.content);
    emptySupport.support = {
      status: 'empty_paired_support',
      pairedObservationIds: [],
      excludedObservationIds: emptySupport.support.excludedObservationIds,
      missingDistributionObservationIds: [],
    };
    expect(() =>
      governedNativePlayerPavQualificationEvidenceSchema.parse({
        evidenceId: createAflTradeContentAddress(
          'native-player-pav-qualification-evidence',
          emptySupport
        ),
        content: emptySupport,
      })
    ).toThrow(/point metrics|distribution metrics/i);

    const incompleteSupport = structuredClone(completeEvidence.content);
    incompleteSupport.support.status = 'incomplete_distribution_support';
    incompleteSupport.support.missingDistributionObservationIds = [
      incompleteSupport.support.pairedObservationIds[0]!,
    ];
    expect(() =>
      governedNativePlayerPavQualificationEvidenceSchema.parse({
        evidenceId: createAflTradeContentAddress(
          'native-player-pav-qualification-evidence',
          incompleteSupport
        ),
        content: incompleteSupport,
      })
    ).toThrow(/distribution metrics/i);
  });
});
