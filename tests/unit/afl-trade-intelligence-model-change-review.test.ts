import { describe, expect, it } from 'vitest';

import {
  aflTradeModelChangeReviewContentSchema,
  aflTradeModelChangeReviewSchema,
  createAflTradeModelChangeReview,
  type AflTradeModelChangeReviewContent,
} from '@/server/aflTradeIntelligence/operations/modelChangeReview';

const digest = (character: string) => character.repeat(64);

function artifact(character: string, createdAt = '2026-08-05T00:00:00.000Z') {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

function components(prefix: 'current' | 'candidate') {
  const characters = prefix === 'current' ? ['1', '2', '3', '4'] : ['5', '6', '7', '8'];
  return [
    {
      component: 'player_contribution' as const,
      modelProtocolId: `model-protocol:${digest(characters[0])}`,
      modelRunId: `model-run:${digest(characters[1])}`,
    },
    {
      component: 'draft_pick_distribution' as const,
      modelProtocolId: `model-protocol:${digest(characters[2])}`,
      modelRunId: `model-run:${digest(characters[3])}`,
    },
  ];
}

function content(): AflTradeModelChangeReviewContent {
  return {
    schemaVersion: 'afl-trade-model-change-review/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    reviewKind: 'scheduled_recalibration',
    reviewSequence: 1,
    previousReviewId: null,
    proposedAt: '2026-08-05T01:00:00.000Z',
    proposedBy: 'fixture-model-owner',
    reviewedAt: '2026-08-05T04:00:00.000Z',
    currentRelease: {
      valuationBundleId: `valuation-bundle:${digest('9')}`,
      components: components('current'),
    },
    candidateRelease: {
      valuationBundleId: `valuation-bundle:${digest('a')}`,
      components: components('candidate'),
    },
    preRegisteredChangePlanArtifact: artifact('b'),
    changes: [
      {
        area: 'training_window',
        materiality: 'material',
        summary: 'Advance the historical training window through the approved evidence cutoff.',
        rationaleArtifact: artifact('c'),
      },
    ],
    compatibilityDisposition: 'same_value_unit_compatible',
    evidence: {
      baselineComparisonArtifact: artifact('d'),
      temporalValidationArtifact: artifact('e'),
      calibrationAndCoverageArtifact: artifact('f'),
      subgroupPerformanceArtifact: artifact('0'),
      sensitivityArtifact: artifact('1'),
      leakageAuditArtifact: artifact('2'),
      lineageInvariantArtifact: artifact('3'),
      publicContractParityArtifact: artifact('4'),
      shadowEvaluationArtifact: artifact('5'),
      rollbackRehearsalArtifact: artifact('6'),
    },
    reviewers: [
      {
        reviewer: 'fixture-model-reviewer',
        responsibility: 'model_reviewer',
        reviewedAt: '2026-08-05T02:00:00.000Z',
        recommendation: 'advance',
        attestationArtifact: artifact('7'),
      },
      {
        reviewer: 'fixture-risk-reviewer',
        responsibility: 'risk_reviewer',
        reviewedAt: '2026-08-05T03:00:00.000Z',
        recommendation: 'advance',
        attestationArtifact: artifact('8'),
      },
    ],
    decision: 'recommend_gate_3_review',
    decisionRationale:
      'All source-independent validation evidence supports external Gate 3 review.',
    monitoringPlanArtifact: artifact('9'),
    rollbackPlanArtifact: artifact('a'),
    nextAuthority: 'gate_3_decision_ledger',
  };
}

describe('AFL trade-intelligence model-change review', () => {
  it('creates a content-addressed recommendation that preserves Gate 3 authority', () => {
    const review = createAflTradeModelChangeReview(content());

    expect(review.reviewId).toMatch(/^model-change-review:[a-f0-9]{64}$/);
    expect(review.content.decision).toBe('recommend_gate_3_review');
    expect(review.content.nextAuthority).toBe('gate_3_decision_ledger');
  });

  it('requires a distinct candidate release and complete component set', () => {
    const review = content();
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        candidateRelease: {
          ...review.candidateRelease,
          valuationBundleId: review.currentRelease.valuationBundleId,
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        reviewers: [
          review.reviewers[0],
          { ...review.reviewers[1], responsibility: 'model_reviewer' },
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        candidateRelease: {
          ...review.candidateRelease,
          components: [
            review.candidateRelease.components[0],
            review.candidateRelease.components[0],
          ],
        },
      }).success
    ).toBe(false);
  });

  it('requires unique independent reviewers and unanimous advance recommendations', () => {
    const review = content();
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        reviewers: [{ ...review.reviewers[0], reviewer: review.proposedBy }, review.reviewers[1]],
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        reviewers: [review.reviewers[0], { ...review.reviewers[1], recommendation: 'revise' }],
      }).success
    ).toBe(false);
  });

  it('requires value-unit changes to declare a new incompatible comparison unit', () => {
    const review = content();
    const changed = {
      ...review,
      changes: [
        {
          ...review.changes[0],
          area: 'value_unit' as const,
        },
      ],
    };

    expect(aflTradeModelChangeReviewContentSchema.safeParse(changed).success).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...changed,
        compatibilityDisposition: 'new_value_unit_required',
      }).success
    ).toBe(true);
  });

  it('enforces pre-registration, review chronology, and append-only predecessor links', () => {
    const review = content();
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        preRegisteredChangePlanArtifact: artifact('b', '2026-08-05T01:01:00.000Z'),
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        reviewSequence: 2,
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        reviewSequence: 2,
        previousReviewId: `model-change-review:${digest('f')}`,
      }).success
    ).toBe(true);
  });

  it('rejects fantasy ownership and invented approval or publication fields', () => {
    const review = content();
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
    expect(
      aflTradeModelChangeReviewContentSchema.safeParse({
        ...review,
        modelApproved: true,
        published: true,
      }).success
    ).toBe(false);
  });

  it('detects any mutation after the review identifier is created', () => {
    const review = createAflTradeModelChangeReview(content());
    expect(
      aflTradeModelChangeReviewSchema.safeParse({
        ...review,
        content: { ...review.content, decisionRationale: 'Mutated after review.' },
      }).success
    ).toBe(false);
  });
});
