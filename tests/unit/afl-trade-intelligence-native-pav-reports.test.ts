import { beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  aflTradeNativePavFinalEvidenceSchema,
  createAflTradeNativePavReportDocuments,
  authenticateAflTradeNativePavReportDocuments,
  interpretAflTradeNativePavMetricDefinitions,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavReports';
import { evaluateAflTradeAdmittedPlayerPavFinal } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavFinalEvaluation';
import { nativePavFinalEvidenceFixture } from '../testUtils/nativePavFinalEvidenceFixture';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

let fixture: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
beforeAll(async () => {
  fixture = await nativePavModelRunSqlFixture();
}, 120_000);
function declaration() {
  return {
    schemaVersion: 'afl-trade-native-pav-metric-definition/v1',
    definitionKey: 'synthetic-explicit-native-metrics',
    target: {
      fixedHorizonSeasons: 3,
      annualValueUnit: 'season_pav',
      aggregation: 'sum',
      valueUnit: 'fixed_horizon_pav',
    },
    evaluationPartitions: ['validation', 'final_test'],
    scopes: ['annual_1', 'annual_2', 'annual_3', 'cumulative_3'],
    metrics: ['bias', 'mae', 'rmse', 'crps', 'intervalCoverage', 'intervalWidth', 'intervalScore'],
    pointError: 'prediction_minus_observed',
    distribution: 'empirical_calibration_paths',
    pointSupport: 'available_forecasts_with_complete_observed_horizon',
    distributionSupport: 'point_support_with_available_calibration_paths',
  };
}
function prepared(document: unknown) {
  const reference = createAflTradeCanonicalJsonArtifactRef(document, fixture.startedAt);
  const protocol = createAflTradePlayerPavModelProtocol({
    ...fixture.protocol.content,
    validationPlan: {
      ...fixture.protocol.content.validationPlan,
      metricDefinitionArtifacts: [reference],
    },
  });
  return {
    protocol,
    artifacts: [{ reference, bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)) }],
  };
}
it('interprets exact declared native H3 metrics without inventing acceptance thresholds', () => {
  const document = declaration();
  const input = prepared(document);
  expect(interpretAflTradeNativePavMetricDefinitions(input.protocol, input.artifacts)).toEqual([
    { reference: input.artifacts[0]!.reference, definition: document },
  ]);
});
it('authenticates actual final numerical evidence without converting it into qualification', () => {
  const result = evaluateAflTradeAdmittedPlayerPavFinal(nativePavFinalEvidenceFixture(fixture));
  expect(aflTradeNativePavFinalEvidenceSchema.parse(result)).toEqual(result);
  expect(
    aflTradeNativePavFinalEvidenceSchema.safeParse({
      ...result,
      content: {
        ...result.content,
        finalMetrics: { ...result.content.finalMetrics, observationCount: 200 },
      },
    }).success
  ).toBe(false);
});
it('reads legacy aggregate evidence without relabeling it as paired precision evidence', () => {
  const result = evaluateAflTradeAdmittedPlayerPavFinal(nativePavFinalEvidenceFixture(fixture));
  const content = {
    ...result.content,
    schemaVersion: 'afl-trade-native-pav-final-evaluation/v1',
    baselineComparisons: result.content.baselineComparisons.map(
      ({ pairedScores: _scores, ...rest }) => rest
    ),
  };
  const legacy = {
    evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
    content,
  };
  expect(aflTradeNativePavFinalEvidenceSchema.parse(legacy)).toEqual(legacy);
  const mislabeled = { ...content, schemaVersion: 'afl-trade-native-pav-final-evaluation/v2' };
  expect(
    aflTradeNativePavFinalEvidenceSchema.safeParse({
      evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', mislabeled),
      content: mislabeled,
    }).success
  ).toBe(false);
});
it('rejects readdressed paired scores with a different dependence origin', () => {
  const result = evaluateAflTradeAdmittedPlayerPavFinal(nativePavFinalEvidenceFixture(fixture));
  const content = structuredClone(result.content);
  content.baselineComparisons[0]!.pairedScores[0]!.predictionSeason += 1;
  expect(
    aflTradeNativePavFinalEvidenceSchema.safeParse({
      evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
      content,
    }).success
  ).toBe(false);
});
it('creates eleven native documents from retained results without reopening targets', () => {
  const parents = nativePavFinalEvidenceFixture(fixture);
  const finalEvidence = evaluateAflTradeAdmittedPlayerPavFinal(parents);
  parents.fitInput.pavObservationSet = structuredClone(parents.fitInput.pavObservationSet);
  const metricDefinitionArtifacts =
    fixture.protocol.content.validationPlan.metricDefinitionArtifacts.map((reference) => ({
      reference,
      bytes: fixture.evidence.executableArtifacts.find(
        (item) => item.artifactId === reference.artifactId
      )!.bytes,
    }));
  for (const row of parents.fitInput.pavObservationSet.content.observations) {
    Object.defineProperty(row, 'outcome', {
      configurable: true,
      get() {
        throw new Error('Report generation reopened a numerical outcome');
      },
    });
  }
  const documents = createAflTradeNativePavReportDocuments({
    parents,
    finalEvidence,
    metricDefinitionArtifacts,
  });
  expect(Object.keys(documents).sort()).toEqual([
    'baselineComparisonArtifact',
    'calibrationReportArtifact',
    'diagnosticsArtifact',
    'intervalCoverageArtifact',
    'leakageAuditArtifact',
    'modelArtifact',
    'modelCardArtifact',
    'selectionValidationReportArtifact',
    'sensitivityReportArtifact',
    'subgroupReportArtifact',
    'validationReportArtifact',
  ]);
  expect(documents.validationReportArtifact).toEqual(finalEvidence);
  expect(documents.baselineComparisonArtifact.content.comparisons).toEqual(
    finalEvidence.content.baselineComparisons
  );
  expect(documents.sensitivityReportArtifact.content.evaluatedPartition).toBe('validation');
  expect(documents.subgroupReportArtifact.content.dimensions).toEqual(
    ['era', 'role', 'position', 'age', 'availability_state', 'evidence_quality'].map(
      (dimension) => ({
        dimension,
        state: 'unsupported',
        reason: 'no_admitted_grouping_evidence',
      })
    )
  );
});
it.each([
  'wrong_bytes',
  'scalar_unit',
  'unknown_metric',
  'short_horizon',
  'undeclared_threshold',
] as const)('rejects %s before native final work can be started', (change) => {
  const original = declaration();
  const input = prepared(
    change === 'scalar_unit'
      ? { ...original, target: { ...original.target, valueUnit: 'scalar_value' } }
      : change === 'unknown_metric'
        ? { ...original, metrics: ['accuracy'] }
        : change === 'short_horizon'
          ? { ...original, target: { ...original.target, fixedHorizonSeasons: 1 } }
          : change === 'undeclared_threshold'
            ? { ...original, minimumMaeImprovement: 0.1 }
            : original
  );
  if (change === 'wrong_bytes') input.artifacts[0]!.bytes = new TextEncoder().encode('{}');
  expect(() =>
    interpretAflTradeNativePavMetricDefinitions(input.protocol, input.artifacts)
  ).toThrow();
});

it('rejects a readdressed report belonging to another committed start and changed retained document', () => {
  const parents = nativePavFinalEvidenceFixture(fixture);
  const finalEvidence = evaluateAflTradeAdmittedPlayerPavFinal(parents);
  const metricDefinitionArtifacts =
    fixture.protocol.content.validationPlan.metricDefinitionArtifacts.map((reference) => ({
      reference,
      bytes: fixture.evidence.executableArtifacts.find(
        (item) => item.artifactId === reference.artifactId
      )!.bytes,
    }));
  const input = { parents, finalEvidence, metricDefinitionArtifacts };
  const documents = createAflTradeNativePavReportDocuments(input);
  expect(authenticateAflTradeNativePavReportDocuments(documents, input)).toEqual(documents);
  expect(() =>
    authenticateAflTradeNativePavReportDocuments(
      {
        ...documents,
        subgroupReportArtifact: { ...documents.subgroupReportArtifact, accepted: true },
      },
      input
    )
  ).toThrow('exact native report documents');
  const content = {
    ...finalEvidence.content,
    finalTestStartedCheckpointId: createAflTradeContentAddress('model-run-checkpoint', {
      synthetic: 'different start',
    }),
  };
  expect(() =>
    createAflTradeNativePavReportDocuments({
      ...input,
      finalEvidence: {
        content,
        evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
      },
    })
  ).toThrow('exact retained numerical parents');
});

it('rejects a coherently readdressed validation plan from another root', () => {
  const parents = nativePavFinalEvidenceFixture(fixture);
  const finalEvidence = evaluateAflTradeAdmittedPlayerPavFinal(parents);
  const content = {
    ...parents.validationPlanEvidence.content,
    intentId: createAflTradeContentAddress('model-run-intent', { synthetic: 'another root' }),
  };
  const validationPlanEvidence = {
    content,
    evaluationId: createAflTradeContentAddress('native-pav-validation-plan-evidence', content),
  };
  const validationPlanArtifact = createAflTradeCanonicalJsonArtifactRef(
    validationPlanEvidence,
    fixture.startedAt
  );
  const finalContent = {
    ...finalEvidence.content,
    validationPlanArtifact,
    validationPlanEvaluationId: validationPlanEvidence.evaluationId,
  };
  expect(() =>
    createAflTradeNativePavReportDocuments({
      parents: { ...parents, validationPlanEvidence, validationPlanArtifact },
      finalEvidence: {
        content: finalContent,
        evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', finalContent),
      },
      metricDefinitionArtifacts:
        fixture.protocol.content.validationPlan.metricDefinitionArtifacts.map((reference) => ({
          reference,
          bytes: fixture.evidence.executableArtifacts.find(
            (item) => item.artifactId === reference.artifactId
          )!.bytes,
        })),
    })
  ).toThrow('exact retained numerical parents');
});
