import { describe, expect, it } from 'vitest';

import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeStructuredExplanationContentSchema,
  aflTradeStructuredExplanationSchema,
  aflTradeStructuredExplanationStatementSchema,
  renderAflTradeStructuredExplanationStatement,
} from '@/server/aflTradeIntelligence/valuation/structuredExplanations';

function digest(character: string): string {
  return character.repeat(64);
}

function artifact(character: string): AflTradeArtifactRef {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

type StatementSource = Parameters<typeof renderAflTradeStructuredExplanationStatement>[0];

function statementSources(): StatementSource[] {
  return [
    {
      statementId: 'statement:1',
      template: 'definition_assumption',
      claimKind: 'assumption',
      polarity: 'neutral',
      reasonCode: 'low_return_definition_assumption',
      definitionName: 'low return',
      definitionArtifact: artifact('1'),
    },
    {
      statementId: 'statement:2',
      template: 'distribution_summary',
      claimKind: 'model_estimate',
      polarity: 'neutral',
      reasonCode: 'package_distribution_summary',
      aflClubId: 'club-a',
      clubName: 'Club A',
      view: 'at_trade',
      layer: 'scarcity_adjusted',
      mean: 12.345,
      median: 11.5,
      valuationSnapshotId: `valuation-snapshot:${digest('2')}`,
    },
    {
      statementId: 'statement:3',
      template: 'root_driver',
      claimKind: 'model_estimate',
      polarity: 'positive',
      reasonCode: 'positive_root_driver',
      aflClubId: 'club-a',
      clubName: 'Club A',
      view: 'remaining',
      layer: 'scarcity_adjusted',
      rootAssetId: 'asset:player-a',
      weightedMean: 8.125,
      valuationCalculationId: `valuation-calculation:${digest('3')}`,
    },
    {
      statementId: 'statement:4',
      template: 'realized_fact',
      claimKind: 'measured_fact',
      polarity: 'neutral',
      reasonCode: 'recorded_receiving_club_contribution',
      aflClubId: 'club-a',
      clubName: 'Club A',
      rootAssetId: 'asset:player-a',
      contribution: 5,
      valuationCalculationId: `valuation-calculation:${digest('3')}`,
    },
    {
      statementId: 'statement:5',
      template: 'unavailable',
      claimKind: 'unavailable_information',
      polarity: 'neutral',
      reasonCode: 'complete_result_unavailable',
      aflClubId: 'club-b',
      clubName: 'Club B',
      view: 'current',
      reasonCodes: ['realized_evidence_unavailable'],
    },
    {
      statementId: 'statement:6',
      template: 'confidence_warning',
      claimKind: 'low_confidence_output',
      polarity: 'neutral',
      reasonCode: 'confidence_low_or_unavailable',
      aflClubId: 'club-b',
      clubName: 'Club B',
      view: 'current',
      confidenceState: 'unavailable',
      detailReasonCode: 'no-approved-confidence-report',
    },
    {
      statementId: 'statement:7',
      template: 'pairwise_comparison',
      claimKind: 'model_estimate',
      polarity: 'neutral',
      reasonCode: 'pairwise_finish_ahead_probability',
      view: 'at_trade',
      layer: 'scarcity_adjusted',
      leftAflClubId: 'club-a',
      leftClubName: 'Club A',
      rightAflClubId: 'club-b',
      rightClubName: 'Club B',
      leftAheadProbability: 0.6,
      practicallyEquivalentProbability: 0.1,
      rightAheadProbability: 0.3,
      valuationSnapshotId: `valuation-snapshot:${digest('2')}`,
    },
  ];
}

function content() {
  return {
    schemaVersion: 'afl-trade-structured-explanation/v1' as const,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    valuationCaseId: `valuation-case:${digest('4')}`,
    valuationCalculationId: `valuation-calculation:${digest('3')}`,
    valuationSnapshotSetId: `valuation-snapshot-set:${digest('5')}`,
    sourceOfTruth: 'fixed_templates_reason_codes_and_replayable_numeric_sources' as const,
    unconstrainedGenerativeClaims: 'prohibited' as const,
    supportedClaimKinds: [
      'measured_fact',
      'model_estimate',
      'assumption',
      'unavailable_information',
      'low_confidence_output',
    ] as const,
    statements: statementSources().map((source) => ({
      ...source,
      renderedText: renderAflTradeStructuredExplanationStatement(source),
    })),
    limitation:
      'Structured source-independent explanations only; fixture text is not source approval, model calibration, Gate approval, or publication readiness.' as const,
  };
}

describe('AFL trade structured explanations', () => {
  it('renders every claim kind through fixed deterministic templates', () => {
    const parsed = aflTradeStructuredExplanationContentSchema.parse(content());

    expect(parsed.statements.map((statement) => statement.claimKind)).toEqual([
      'assumption',
      'model_estimate',
      'model_estimate',
      'measured_fact',
      'unavailable_information',
      'low_confidence_output',
      'model_estimate',
    ]);
    expect(parsed.statements[1].renderedText).toContain('mean of 12.35 and median of 11.50');
    expect(parsed.statements[6].renderedText).toContain('Club A finishes ahead with 60.0%');
  });

  it('rejects prose that does not exactly match its structured source values', () => {
    const candidate = content();
    candidate.statements[1].renderedText = 'An unsupported generative claim.';

    expect(aflTradeStructuredExplanationContentSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects claim-kind, polarity, and reason-code relabelling across templates', () => {
    const distribution = statementSources()[1];
    expect(
      aflTradeStructuredExplanationStatementSchema.safeParse({
        ...distribution,
        claimKind: 'measured_fact',
        renderedText: renderAflTradeStructuredExplanationStatement(distribution),
      }).success
    ).toBe(false);
    expect(
      aflTradeStructuredExplanationStatementSchema.safeParse({
        ...distribution,
        polarity: 'positive',
        renderedText: renderAflTradeStructuredExplanationStatement(distribution),
      }).success
    ).toBe(false);
    expect(
      aflTradeStructuredExplanationStatementSchema.safeParse({
        ...distribution,
        reasonCode: 'positive_root_driver',
        renderedText: renderAflTradeStructuredExplanationStatement(distribution),
      }).success
    ).toBe(false);
  });

  it('requires canonical claim-kind support and contiguous statement identities', () => {
    const canonicalContent = content();
    const reversedKinds = {
      ...canonicalContent,
      supportedClaimKinds: [...canonicalContent.supportedClaimKinds].reverse(),
    };
    const skippedId = content();
    skippedId.statements[2].statementId = 'statement:99';
    const duplicateId = content();
    duplicateId.statements[2].statementId = duplicateId.statements[1].statementId;

    expect(aflTradeStructuredExplanationContentSchema.safeParse(reversedKinds).success).toBe(false);
    expect(aflTradeStructuredExplanationContentSchema.safeParse(skippedId).success).toBe(false);
    expect(aflTradeStructuredExplanationContentSchema.safeParse(duplicateId).success).toBe(false);
  });

  it('requires immutable definition evidence for assumptions', () => {
    const source = statementSources()[0];
    if (source.template !== 'definition_assumption') throw new Error('Expected assumption.');
    const invalid = {
      ...source,
      definitionArtifact: {
        ...source.definitionArtifact,
        storageUri: `artifact://sha256/${digest('6')}`,
      },
    };

    expect(
      aflTradeStructuredExplanationStatementSchema.safeParse({
        ...invalid,
        renderedText: renderAflTradeStructuredExplanationStatement(invalid),
      }).success
    ).toBe(false);
  });

  it.each(['userId', 'fantasyTeamId', 'rosterOwnerId', 'legacyExpectedValue'])(
    'rejects forbidden explanation field %s',
    (field) => {
      expect(
        aflTradeStructuredExplanationContentSchema.safeParse({ ...content(), [field]: 'forbidden' })
          .success
      ).toBe(false);
    }
  );

  it('detects structured numerical changes through rendered-text and artifact integrity', () => {
    const validContent = aflTradeStructuredExplanationContentSchema.parse(content());
    const explanation = aflTradeStructuredExplanationSchema.parse({
      structuredExplanationId: createAflTradeContentAddress('structured-explanation', validContent),
      content: validContent,
    });
    const tamperedContent = structuredClone(explanation.content);
    const distribution = tamperedContent.statements[1];
    if (distribution.template !== 'distribution_summary') throw new Error('Expected summary.');
    distribution.mean = 99;
    distribution.renderedText = renderAflTradeStructuredExplanationStatement({
      ...distribution,
      renderedText: undefined,
    } as unknown as StatementSource);

    expect(
      aflTradeStructuredExplanationSchema.safeParse({
        ...explanation,
        content: tamperedContent,
      }).success
    ).toBe(false);
  });
});
