import { describe, expect, it } from 'vitest';

import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
  createAflTradeExternalIdentityReviewPackage,
  createAflTradeExternalIdentityReviewWorkItem,
  createAflTradeExternalIdentitySubject,
  parseAflTradeExternalIdentityReviewDecision,
} from '../../src/server/aflTradeIntelligence/source/externalIdentityReviewContracts';

const digest = (value: string) => value.repeat(64);

function nativeSubject() {
  return createAflTradeExternalIdentitySubject({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider: 'draftguru',
    entityKind: 'player',
    identityScope: { kind: 'provider_native_id', nativeId: 'player-14' },
  });
}

function workItem() {
  const subject = nativeSubject();
  return createAflTradeExternalIdentityReviewWorkItem({
    subject,
    observations: [
      {
        evidenceId: `external-evidence:${digest('b')}`,
        batchId: `external-evidence-batch:${digest('c')}`,
        sourceIdentity: { nativeId: 'player-14', recordedName: 'Player Fourteen' },
        seasonYear: 2025,
        capturedAt: '2026-08-10T00:00:02.000Z',
      },
      {
        evidenceId: `external-evidence:${digest('a')}`,
        batchId: `external-evidence-batch:${digest('d')}`,
        sourceIdentity: { nativeId: 'player-14', recordedName: 'P. Fourteen' },
        seasonYear: 2024,
        capturedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
  });
}

describe('external identity review contracts', () => {
  it('groups a provider-native identity without normalizing its observed names', () => {
    const item = workItem();

    expect(item.content.subject.content.identityScope).toEqual({
      kind: 'provider_native_id',
      nativeId: 'player-14',
    });
    expect(item.content.observations.map(({ evidenceId }) => evidenceId)).toEqual([
      `external-evidence:${digest('a')}`,
      `external-evidence:${digest('b')}`,
    ]);
    expect(item.content.observedNames).toEqual(['P. Fourteen', 'Player Fourteen']);
    expect(item.content.validFromSeason).toBe(2024);
    expect(item.content.validThroughSeason).toBe(2025);
  });

  it('requires a name-only subject to remain exact and season scoped', () => {
    const subject = createAflTradeExternalIdentitySubject({
      environment: 'production',
      competition: 'AFLM',
      provider: 'draftguru',
      entityKind: 'club',
      identityScope: {
        kind: 'exact_recorded_name',
        recordedName: 'North Melbourne',
        seasonYear: 2025,
      },
    });

    expect(() =>
      createAflTradeExternalIdentityReviewWorkItem({
        subject,
        observations: [
          {
            evidenceId: `external-evidence:${digest('a')}`,
            batchId: `external-evidence-batch:${digest('b')}`,
            sourceIdentity: { nativeId: null, recordedName: 'Nth Melbourne' },
            seasonYear: 2025,
            capturedAt: '2026-08-10T00:00:01.000Z',
          },
        ],
      })
    ).toThrow(/exact recorded name/i);
  });

  it('seals a canonically ordered completion-backed review package', () => {
    const first = workItem();
    const second = createAflTradeExternalIdentityReviewWorkItem({
      subject: createAflTradeExternalIdentitySubject({
        environment: 'test_fixture',
        competition: 'AFLM',
        provider: 'draftguru',
        entityKind: 'club',
        identityScope: { kind: 'provider_native_id', nativeId: 'club-1' },
      }),
      observations: [
        {
          evidenceId: `external-evidence:${digest('e')}`,
          batchId: `external-evidence-batch:${digest('f')}`,
          sourceIdentity: { nativeId: 'club-1', recordedName: 'Club One' },
          seasonYear: 2025,
          capturedAt: '2026-08-10T00:00:01.000Z',
        },
      ],
    });

    const reviewPackage = createAflTradeExternalIdentityReviewPackage({
      completionId: `external-historical-capture-completion:${digest('1')}`,
      completionSha256: digest('1'),
      environment: 'test_fixture',
      competition: 'AFLM',
      completedAt: '2026-08-10T00:00:02.000Z',
      items: [first, second],
    });

    expect(reviewPackage.content.items.map(({ subjectId }) => subjectId)).toEqual(
      [...reviewPackage.content.items.map(({ subjectId }) => subjectId)].sort()
    );
    expect(reviewPackage.content.itemCount).toBe(2);
    expect(reviewPackage.content.publicationEligible).toBe(false);
  });

  it('binds an approved target, exact work item, revision, and reviewer authority', () => {
    const item = workItem();
    const reviewPackage = createAflTradeExternalIdentityReviewPackage({
      completionId: `external-historical-capture-completion:${digest('1')}`,
      completionSha256: digest('1'),
      environment: 'test_fixture',
      competition: 'AFLM',
      completedAt: '2026-08-10T00:00:02.000Z',
      items: [item],
    });
    const decision = createAflTradeExternalIdentityReviewDecision({
      subject: item.content.subject,
      reviewPackageId: reviewPackage.packageId,
      reviewPackageSha256: reviewPackage.packageId.split(':')[1]!,
      workItemId: item.workItemId,
      workItemSha256: item.workItemId.split(':')[1]!,
      workItem: item,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      canonicalTarget: {
        ...createAflTradeExternalCanonicalIdentityTargetSnapshot({
          entityKind: 'player',
          canonicalId: 'player:harry-kyle',
          recordedLabel: 'Harry Kyle',
        }),
      },
      rationale: 'Reviewed against the official draft selection and player record.',
      authorityEvidenceId: `reviewer-authority-evidence:${digest('8')}`,
      decidedBy: 'reviewer:fixture',
      decidedAt: '2026-08-10T00:00:03.000Z',
    });

    expect(parseAflTradeExternalIdentityReviewDecision(decision)).toEqual(decision);
    expect(decision.decisionId).toMatch(/^review-decision:[a-f0-9]{64}$/);
    expect(decision.content.canonicalTarget?.canonicalId).toBe('player:harry-kyle');
  });

  it('rejects target-kind drift and broken correction chains', () => {
    const item = workItem();
    const reviewPackage = createAflTradeExternalIdentityReviewPackage({
      completionId: `external-historical-capture-completion:${digest('1')}`,
      completionSha256: digest('1'),
      environment: 'test_fixture',
      competition: 'AFLM',
      completedAt: '2026-08-10T00:00:02.000Z',
      items: [item],
    });
    const base = {
      subject: item.content.subject,
      reviewPackageId: reviewPackage.packageId,
      reviewPackageSha256: reviewPackage.packageId.split(':')[1]!,
      workItemId: item.workItemId,
      workItemSha256: item.workItemId.split(':')[1]!,
      workItem: item,
      decision: 'approved' as const,
      canonicalTarget: {
        ...createAflTradeExternalCanonicalIdentityTargetSnapshot({
          entityKind: 'club',
          canonicalId: 'club:carlton',
          recordedLabel: 'Carlton',
        }),
      },
      rationale: 'Invalid cross-kind mapping.',
      authorityEvidenceId: `reviewer-authority-evidence:${digest('8')}`,
      decidedBy: 'reviewer:fixture',
      decidedAt: '2026-08-10T00:00:03.000Z',
    };

    expect(() =>
      createAflTradeExternalIdentityReviewDecision({
        ...base,
        revision: 1,
        supersedesDecisionId: null,
      })
    ).toThrow(/entity kind/i);

    expect(() =>
      createAflTradeExternalIdentityReviewDecision({
        ...base,
        canonicalTarget: null,
        decision: 'withdrawn',
        revision: 2,
        supersedesDecisionId: null,
      })
    ).toThrow(/revision/i);
  });
});
