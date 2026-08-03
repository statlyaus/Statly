import { describe, expect, it } from 'vitest';

import {
  aflTradeCoverageReportSchema,
  validateAflTradeCoverageAgainstProtocol,
} from '@/server/aflTradeIntelligence/artifacts/coverageReport';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeDataSufficiencyProtocolSchema,
  type AflTradeDataSufficiencyProtocol,
} from '@/server/aflTradeIntelligence/governance/dataSufficiencyProtocol';

const ids = {
  evidence: `evidence:${'e'.repeat(64)}`,
  artifact: 'a'.repeat(64),
};

function artifact() {
  return {
    artifactId: `artifact:${ids.artifact}`,
    contentSha256: ids.artifact,
    storageUri: `artifact://sha256/${ids.artifact}`,
    mediaType: 'application/json',
    byteLength: 256,
    createdAt: '2026-08-02T01:00:00.000Z',
  };
}

function protocolContent() {
  return {
    schemaVersion: 'afl-trade-data-sufficiency-protocol/v1' as const,
    protocolKey: 'fixture-gate-0b-v1',
    version: 1,
    environment: 'test_fixture' as const,
    evidenceManifestId: ids.evidence,
    scope: {
      scopeKey: 'fixture-historical-trades',
      description: 'Fabricated cohorts used only for sufficiency contract tests.',
      dimensions: [{ name: 'season', values: ['2024', '2025'] }],
      exclusions: ['All production evidence'],
    },
    estimand: 'Whether fabricated evidence is structurally measurable for later research.',
    evidenceLanes: [
      {
        lane: 'transactions_and_lineage' as const,
        description: 'Fabricated transactions, assets, and lineage.',
        requiredFields: ['trade_id', 'asset_id', 'effective_at'],
        cohortIds: ['season-2024', 'season-2025'],
      },
      {
        lane: 'player_contribution_and_availability' as const,
        description: 'Fabricated appearances, exposure, contribution, and availability.',
        requiredFields: ['player_id', 'appearance', 'exposure'],
        cohortIds: ['season-2024', 'season-2025'],
      },
      {
        lane: 'point_in_time_current_state' as const,
        description: 'Fabricated club custody and point-in-time state.',
        requiredFields: ['club_id', 'recorded_at', 'effective_at'],
        cohortIds: ['season-2024', 'season-2025'],
      },
    ],
    identityAndQuarantinePolicy: {
      automaticIdentityMerge: 'prohibited' as const,
      ambiguousIdentity: 'quarantine' as const,
      unresolvedIdentity: 'quarantine' as const,
      conflictingEvidence: 'quarantine' as const,
      quarantinedApprovalNumerator: 'excluded' as const,
      quarantinedEligibleDenominator: 'included' as const,
      manualResolutionRequiresEvidence: true as const,
    },
    cohorts: [
      {
        cohortId: 'season-2024',
        description: 'Fabricated 2024 cohort.',
        dimensions: [{ name: 'season', values: ['2024'] }],
      },
      {
        cohortId: 'season-2025',
        description: 'Fabricated 2025 cohort.',
        dimensions: [{ name: 'season', values: ['2025'] }],
      },
    ],
    measures: [
      {
        measureId: 'trade-coverage',
        category: 'coverage' as const,
        description: 'Share of expected fabricated trades observed.',
        numeratorDefinition: 'Count of observed fabricated trade records.',
        denominatorDefinition: 'Count of expected fabricated trade records.',
        evidenceLanes: [
          'transactions_and_lineage' as const,
          'player_contribution_and_availability' as const,
          'point_in_time_current_state' as const,
        ],
        cohortIds: ['season-2024', 'season-2025'],
        requiredForApproval: true,
        minimumRatio: { numerator: '95', denominator: '100' },
      },
      {
        measureId: 'field-missingness',
        category: 'missingness' as const,
        description: 'Observed presence of a fabricated optional field.',
        numeratorDefinition: 'Count with the field present.',
        denominatorDefinition: 'Count eligible for the field.',
        evidenceLanes: ['player_contribution_and_availability' as const],
        cohortIds: ['season-2024'],
        requiredForApproval: false,
        minimumRatio: null,
      },
    ],
    nullZeroSemantics: [
      {
        field: 'fixture_stat',
        unknownMeaning: 'The fabricated source supplied no observation.',
        observedZeroMeaning: 'The fabricated source explicitly supplied zero.',
      },
    ],
    candidateWindows: {
      train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      calibration: { from: '2021-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      validation: { from: '2022-01-08T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
      finalTest: { from: '2023-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 7,
    },
    exclusions: ['Unresolvable fabricated identities'],
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
}

function protocol(content = protocolContent()): AflTradeDataSufficiencyProtocol {
  return aflTradeDataSufficiencyProtocolSchema.parse({
    protocolId: createAflTradeContentAddress('data-sufficiency-protocol', content),
    content,
  });
}

function reportContent(sourceProtocol = protocol()) {
  return {
    schemaVersion: 'afl-trade-coverage-report/v1' as const,
    protocolId: sourceProtocol.protocolId,
    evidenceManifestId: ids.evidence,
    environment: 'test_fixture' as const,
    sourceRegisterIds: ['fixture-source-v1'],
    measurementStartedAt: '2026-08-02T00:00:00.000Z',
    measurementCompletedAt: '2026-08-02T01:00:00.000Z',
    createdAt: '2026-08-02T01:00:01.000Z',
    observations: [
      {
        measureId: 'trade-coverage',
        cohortId: 'season-2024',
        status: 'measured' as const,
        observedRatio: { numerator: '96', denominator: '100' },
        supportingArtifacts: [artifact()],
      },
      {
        measureId: 'trade-coverage',
        cohortId: 'season-2025',
        status: 'measured' as const,
        observedRatio: { numerator: '94', denominator: '100' },
        supportingArtifacts: [artifact()],
      },
      {
        measureId: 'field-missingness',
        cohortId: 'season-2024',
        status: 'measured' as const,
        observedRatio: { numerator: '80', denominator: '100' },
        supportingArtifacts: [artifact()],
      },
    ],
    findings: ['One fabricated cohort is below its prespecified floor.'],
    unsupportedCohorts: [],
  };
}

function report(sourceProtocol = protocol()) {
  const content = reportContent(sourceProtocol);
  return aflTradeCoverageReportSchema.parse({
    reportId: createAflTradeContentAddress('coverage-report', content),
    content,
  });
}

describe('AFL trade-intelligence data-sufficiency contracts', () => {
  it('evaluates every prespecified cohort with exact rational arithmetic', () => {
    const sourceProtocol = protocol();
    const validation = validateAflTradeCoverageAgainstProtocol(
      sourceProtocol,
      report(sourceProtocol)
    );

    expect(validation.valid).toBe(true);
    expect(validation.approvalEligible).toBe(false);
    expect(validation.outcomes).toEqual([
      {
        measureId: 'trade-coverage',
        cohortId: 'season-2024',
        requiredForApproval: true,
        status: 'met',
      },
      {
        measureId: 'trade-coverage',
        cohortId: 'season-2025',
        requiredForApproval: true,
        status: 'not_met',
      },
      {
        measureId: 'field-missingness',
        cohortId: 'season-2024',
        requiredForApproval: false,
        status: 'report_only',
      },
    ]);
  });

  it('requires every approval measure to declare its own threshold', () => {
    const content = protocolContent();
    content.measures[0].minimumRatio = null;

    expect(
      aflTradeDataSufficiencyProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('data-sufficiency-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('requires every evidence lane and every lane cohort to have an approval measure', () => {
    const missingLane = protocolContent();
    missingLane.evidenceLanes = missingLane.evidenceLanes.slice(1);
    const unevaluatedCohort = protocolContent();
    unevaluatedCohort.measures[0].cohortIds = ['season-2024'];

    for (const content of [missingLane, unevaluatedCohort]) {
      expect(
        aflTradeDataSufficiencyProtocolSchema.safeParse({
          protocolId: createAflTradeContentAddress('data-sufficiency-protocol', content),
          content,
        }).success
      ).toBe(false);
    }
  });

  it('requires one unambiguous null-and-zero declaration per field', () => {
    const content = protocolContent();
    content.nullZeroSemantics.push({ ...content.nullZeroSemantics[0] });
    expect(
      aflTradeDataSufficiencyProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('data-sufficiency-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects quarantine denominator laundering and duplicate cohort dimensions', () => {
    const base = protocolContent();
    const laundered = {
      ...base,
      identityAndQuarantinePolicy: {
        ...base.identityAndQuarantinePolicy,
        quarantinedEligibleDenominator: 'excluded',
      },
    };
    const duplicateDimension = protocolContent();
    duplicateDimension.cohorts[0].dimensions.push({
      ...duplicateDimension.cohorts[0].dimensions[0],
    });

    for (const content of [laundered, duplicateDimension]) {
      expect(
        aflTradeDataSufficiencyProtocolSchema.safeParse({
          protocolId: createAflTradeContentAddress('data-sufficiency-protocol', content),
          content,
        }).success
      ).toBe(false);
    }
  });

  it('rejects invalid exact ratios instead of rounding floating-point values', () => {
    const sourceProtocol = protocol();
    const content = reportContent(sourceProtocol);
    content.observations[0] = {
      ...content.observations[0],
      observedRatio: { numerator: '101', denominator: '100' },
    };

    expect(
      aflTradeCoverageReportSchema.safeParse({
        reportId: createAflTradeContentAddress('coverage-report', content),
        content,
      }).success
    ).toBe(false);
  });

  it('requires the protocol to predate measurement', () => {
    const content = protocolContent();
    content.proposedAt = '2026-08-03T00:00:00.000Z';
    const lateProtocol = protocol(content);
    const validation = validateAflTradeCoverageAgainstProtocol(lateProtocol, report(lateProtocol));

    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'protocol_not_preregistered' })
    );
  });

  it('rejects missing and unregistered measure/cohort observations', () => {
    const sourceProtocol = protocol();
    const content = reportContent(sourceProtocol);
    content.observations = [
      ...content.observations.slice(1),
      {
        ...content.observations[0],
        measureId: 'not-prespecified',
      },
    ];
    const changedReport = aflTradeCoverageReportSchema.parse({
      reportId: createAflTradeContentAddress('coverage-report', content),
      content,
    });
    const validation = validateAflTradeCoverageAgainstProtocol(sourceProtocol, changedReport);

    expect(validation.issues.map((issue) => issue.code)).toEqual([
      'observation_missing',
      'observation_unknown',
    ]);
    expect(validation.outcomes[0].status).toBe('missing');
    expect(validation.approvalEligible).toBe(false);
  });

  it('preserves ordered issues and outcomes when independent protocol rules fail together', () => {
    const protocolValue = protocol({
      ...protocolContent(),
      proposedAt: '2026-08-03T00:00:00.000Z',
    });
    const content = reportContent(protocolValue);
    const mismatchedContent = {
      ...content,
      protocolId: `data-sufficiency-protocol:${'d'.repeat(64)}`,
      evidenceManifestId: `evidence:${'f'.repeat(64)}`,
      environment: 'production' as const,
      observations: [
        ...content.observations.slice(1),
        {
          ...content.observations[0],
          measureId: 'not-prespecified',
        },
      ],
    };
    const reportValue = aflTradeCoverageReportSchema.parse({
      reportId: createAflTradeContentAddress('coverage-report', mismatchedContent),
      content: mismatchedContent,
    });

    expect(validateAflTradeCoverageAgainstProtocol(protocolValue, reportValue)).toEqual({
      valid: false,
      approvalEligible: false,
      issues: [
        {
          code: 'protocol_mismatch',
          subject: mismatchedContent.protocolId,
          message: 'The coverage report must reference the exact prespecified protocol.',
        },
        {
          code: 'evidence_mismatch',
          subject: mismatchedContent.evidenceManifestId,
          message: 'The coverage report and protocol must reference the same evidence manifest.',
        },
        {
          code: 'environment_mismatch',
          subject: mismatchedContent.environment,
          message: 'The coverage report and protocol must use the same environment.',
        },
        {
          code: 'protocol_not_preregistered',
          subject: protocolValue.protocolId,
          message: 'The sufficiency protocol must exist before coverage measurement starts.',
        },
        {
          code: 'observation_missing',
          subject: 'trade-coverage|season-2024',
          message: 'Coverage observation trade-coverage|season-2024 is missing.',
        },
        {
          code: 'observation_unknown',
          subject: 'not-prespecified|season-2024',
          message: 'Coverage observation not-prespecified|season-2024 was not prespecified.',
        },
      ],
      outcomes: [
        {
          measureId: 'trade-coverage',
          cohortId: 'season-2024',
          requiredForApproval: true,
          status: 'missing',
        },
        {
          measureId: 'trade-coverage',
          cohortId: 'season-2025',
          requiredForApproval: true,
          status: 'not_met',
        },
        {
          measureId: 'field-missingness',
          cohortId: 'season-2024',
          requiredForApproval: false,
          status: 'report_only',
        },
      ],
    });
  });

  it('keeps unmeasurable evidence distinct from a measured zero', () => {
    const sourceProtocol = protocol();
    const content = reportContent(sourceProtocol);
    content.observations[0] = {
      measureId: 'trade-coverage',
      cohortId: 'season-2024',
      status: 'unmeasurable',
      reason: 'denominator_unavailable',
      explanation: 'The fabricated denominator cannot be reconstructed.',
      supportingArtifacts: [],
    } as unknown as (typeof content.observations)[number];
    const changedReport = aflTradeCoverageReportSchema.parse({
      reportId: createAflTradeContentAddress('coverage-report', content),
      content,
    });

    const validation = validateAflTradeCoverageAgainstProtocol(sourceProtocol, changedReport);
    expect(validation.outcomes[0].status).toBe('unmeasurable');
    expect(validation.valid).toBe(true);
    expect(validation.approvalEligible).toBe(false);
  });

  it('requires wholly unmeasurable cohorts to be declared unsupported', () => {
    const sourceProtocol = protocol();
    const content = reportContent(sourceProtocol);
    content.observations = content.observations.map((observation) =>
      observation.cohortId === 'season-2024'
        ? ({
            measureId: observation.measureId,
            cohortId: observation.cohortId,
            status: 'unmeasurable' as const,
            reason: 'evidence_invalid' as const,
            explanation: 'All fabricated evidence for the cohort is invalid.',
            supportingArtifacts: [],
          } as unknown as (typeof content.observations)[number])
        : observation
    );
    const undeclaredReport = aflTradeCoverageReportSchema.parse({
      reportId: createAflTradeContentAddress('coverage-report', content),
      content,
    });
    expect(
      validateAflTradeCoverageAgainstProtocol(sourceProtocol, undeclaredReport).issues
    ).toContainEqual(expect.objectContaining({ code: 'unsupported_cohort_missing' }));

    const declaredContent = {
      ...content,
      unsupportedCohorts: [
        {
          cohortId: 'season-2024',
          reason: 'evidence_invalid' as const,
          explanation: 'All fabricated evidence for the cohort is invalid.',
        },
      ],
    };
    const declaredReport = aflTradeCoverageReportSchema.parse({
      reportId: createAflTradeContentAddress('coverage-report', declaredContent),
      content: declaredContent,
    });
    expect(validateAflTradeCoverageAgainstProtocol(sourceProtocol, declaredReport)).toMatchObject({
      valid: true,
      approvalEligible: false,
      issues: [],
    });
  });

  it('rejects unknown or measured cohorts labelled unsupported', () => {
    const sourceProtocol = protocol();
    const base = reportContent(sourceProtocol);
    const candidates = [
      {
        expectedCode: 'unsupported_cohort_unknown',
        content: {
          ...base,
          unsupportedCohorts: [
            {
              cohortId: 'not-prespecified',
              reason: 'cohort_empty' as const,
              explanation: 'This cohort was not part of the protocol.',
            },
          ],
        },
      },
      {
        expectedCode: 'unsupported_cohort_has_measured_observation',
        content: {
          ...base,
          unsupportedCohorts: [
            {
              cohortId: 'season-2025',
              reason: 'evidence_invalid' as const,
              explanation: 'This contradicts the measured observation.',
            },
          ],
        },
      },
    ];

    for (const candidate of candidates) {
      const changedReport = aflTradeCoverageReportSchema.parse({
        reportId: createAflTradeContentAddress('coverage-report', candidate.content),
        content: candidate.content,
      });
      expect(
        validateAflTradeCoverageAgainstProtocol(sourceProtocol, changedReport).issues
      ).toContainEqual(expect.objectContaining({ code: candidate.expectedCode }));
    }
  });

  it('returns structured issues for malformed artifacts instead of throwing', () => {
    const sourceProtocol = protocol();
    const sourceReport = report(sourceProtocol);
    const validation = validateAflTradeCoverageAgainstProtocol(
      { ...sourceProtocol, protocolId: 'invalid' } as AflTradeDataSufficiencyProtocol,
      { ...sourceReport, reportId: 'invalid' }
    );

    expect(validation).toMatchObject({ valid: false, approvalEligible: false, outcomes: [] });
    expect(validation.issues.map((issue) => issue.code)).toEqual([
      'protocol_invalid',
      'report_invalid',
    ]);
  });

  it('rejects report or protocol content changed after hashing', () => {
    const sourceProtocol = protocol();
    const sourceReport = report(sourceProtocol);

    expect(
      aflTradeCoverageReportSchema.safeParse({
        ...sourceReport,
        content: { ...sourceReport.content, findings: ['Altered after hashing.'] },
      }).success
    ).toBe(false);
    expect(
      aflTradeDataSufficiencyProtocolSchema.safeParse({
        ...sourceProtocol,
        content: { ...sourceProtocol.content, estimand: 'Altered after hashing.' },
      }).success
    ).toBe(false);
  });
});
