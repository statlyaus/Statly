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
    excludedCohorts: [],
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
