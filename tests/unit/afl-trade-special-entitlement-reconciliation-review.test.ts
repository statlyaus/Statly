import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { resolveSpecialEntitlementCustody } from '@/server/aflTradeIntelligence/source/resolveSpecialEntitlementCustody';
import { createSpecialEntitlementAward } from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import { describe, expect, it } from 'vitest';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { buildAndPersistAflTradeExternalReconciliation } from '@/server/aflTradeIntelligence/source/externalReconciliationCommand';
import { reviewSpecialEntitlementReconciliation } from '@/server/aflTradeIntelligence/source/specialEntitlementReconciliationReview';

function fixture(
  occurredOn: string | null = '2010-10-02',
  selectedPlayerId = 'p',
  component = 'CMP1 (Synthetic)',
  renumbered = false
) {
  const at = '2026-09-12T00:00:00.000Z';
  const entity = (name: string) => ({ nativeId: name, recordedName: name });
  const asset = {
    kind: 'special_pick' as const,
    entitlementType: 'expansion_compensation' as const,
    sourceLabel: component,
    draftYear: null,
    selectionOrdinal: null,
  };
  const capture = {
    captureId: `source-capture:${'1'.repeat(64)}`,
    artifactId: `artifact:${'2'.repeat(64)}`,
    contentSha256: '2'.repeat(64),
    sourceUrl: 'fixture://statly/review',
    mediaType: 'text/html',
    capturedAt: at,
    effectiveAt: at,
    parserVersion: 'fixture',
    fieldManifestSha256: '3'.repeat(64),
  };
  const claims: AflTradeExternalEvidenceContent['claim'][] = [
    {
      kind: 'transaction',
      nativeEventId: 'trade',
      seasonYear: 2010,
      occurredOn,
      transactionType: 'trade',
      title: 'Synthetic',
    },
    {
      kind: 'directed_transfer',
      nativeEventId: 'trade',
      nativeTransferId: 'edge',
      fromClub: entity('a'),
      toClub: entity('b'),
      asset,
    },
    {
      kind: 'draft_selection',
      draftYear: 2013,
      draftType: 'national',
      selectionNumber: 9,
      roundNumber: 1,
      player: entity('p'),
      selectedByClub: entity('b'),
    },
  ];
  if (renumbered) {
    const selection = claims.find((claim) => claim.kind === 'draft_selection');
    if (selection?.kind === 'draft_selection') selection.selectedByClub = entity('a');
    claims.push(
      {
        kind: 'transaction',
        nativeEventId: 'later',
        seasonYear: 2013,
        occurredOn: null,
        transactionType: 'trade',
        title: 'Later custody',
      },
      {
        kind: 'directed_transfer',
        nativeEventId: 'later',
        nativeTransferId: 'later-edge',
        fromClub: entity('b'),
        toClub: entity('a'),
        asset: {
          kind: 'current_pick',
          draftYear: 2013,
          draftType: 'national',
          recordedPickNumber: 7,
          recordedRoundNumber: 1,
          recordedLabel: 'Pick 7',
        },
      }
    );
  }
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: 'afl-trade-external-evidence-batch/v1',
    provider: 'statly_local_fixture',
    captureId: capture.captureId,
    finalizedAt: at,
    publicationEligible: false,
    evidence: claims.map((claim, i) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'statly_local_fixture',
        capture,
        sourceRow: { ordinal: i + 1, sourceKey: String(i) },
        claim,
        publicationEligible: false,
      })
    ),
  });
  const input = {
    environment: 'test_fixture' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2013,
    sourceBatches: [batch],
    reconciledAt: at,
    identityResolutions: ['a', 'b', 'p'].map((name) =>
      createAflTradeExternalIdentityResolution({
        schemaVersion: 'afl-trade-external-identity-resolution/v1',
        provider: 'statly_local_fixture',
        entityKind: name === 'p' ? 'player' : 'club',
        sourceIdentity: entity(name),
        canonicalId: name === 'p' ? selectedPlayerId : name,
        decidedAt: at,
        reviewDecisionId: `review-decision:${'4'.repeat(64)}`,
        reviewDecisionSha256: '4'.repeat(64),
        status: 'current_approved',
      })
    ),
  };
  const candidate = reconcileAflTradeExternalEvidence(input);
  const event = {
    entitlementId: 'right',
    evidence: [
      {
        captureId: capture.captureId,
        sourceUrl: capture.sourceUrl,
        contentSha256: capture.contentSha256,
      },
    ],
  };
  const link = {
    asset,
    award: {
      ...event,
      component: asset.sourceLabel,
      holderClubId: 'a',
      occurredAt: '2010-10-01T00:00:00Z',
    },
    activation: { ...event, draftYear: 2013, occurredAt: '2013-03-01T00:00:00Z' },
    custody: [
      {
        ...event,
        transferId: candidate.content.transfers[0].transferId,
        fromClubId: 'a',
        toClubId: 'b',
        occurredAt: '2010-10-02T00:00:00Z',
      },
    ],
    selection: {
      ...event,
      draftYear: 2013,
      draftType: 'national',
      selectionNumber: 9,
      clubId: 'b',
      playerId: selectedPlayerId,
      occurredAt: '2013-11-01T00:00:00Z',
    },
  };
  if (renumbered) {
    const first = candidate.content.transfers.find(
      (transfer) => transfer.asset.kind === 'special_pick'
    )!;
    link.custody[0].transferId = first.transferId;
    const later = candidate.content.transfers.find(
      (transfer) => transfer.asset.kind === 'pick_entitlement'
    )!;
    link.custody.push({
      ...event,
      transferId: later.transferId,
      fromClubId: 'b',
      toClubId: 'a',
      occurredAt: '2013-10-01T00:00:00Z',
    });
    link.selection.clubId = 'a';
  }
  return { input, candidate, link, sourceBatches: [batch] };
}

describe('entitlement reconciliation binding', () => {
  it('binds evidenced renumbering without changing trade-time picks or inventing dates', () => {
    const f = fixture(null, 'p', 'CMP1 (Synthetic)', true);
    const later = f.candidate.content.transfers.find(
      (transfer) => transfer.asset.kind === 'pick_entitlement'
    )!;
    if (later.asset.kind !== 'pick_entitlement') throw new Error('Missing pick');
    const binding = {
      entitlementId: f.link.award.entitlementId,
      transferId: later.transferId,
      sourcePickId: later.asset.pickId,
      targetPickId: f.candidate.content.draftSelections[0].pickId,
      occurredAt: { precision: 'year', year: 2013 },
      evidence: f.link.selection.evidence,
    };
    const review = (renumbering: unknown[]) =>
      reviewSpecialEntitlementReconciliation({
        ...f,
        links: [{ ...f.link, renumbering }],
      });
    expect(review([]).content.results[0].issues).toContain('canonical_pick_mismatch');
    const result = review([binding]);
    expect(result.content.bindingStatus).toBe('candidate_bound');
    expect(
      result.content.results[0].proposedResolution?.retrospectiveExercise.renumbering?.[0]
        .occurredAt
    ).toEqual({ precision: 'year', year: 2013 });
    expect(later.asset.nominalPick).toBe(7);
    expect(f.candidate.content.draftSelections[0].selectionNumber).toBe(9);
    expect(result.content.promotionEligible).toBe(false);
    for (const invalid of [
      [binding, binding],
      [{ ...binding, sourcePickId: binding.targetPickId }],
      [{ ...binding, targetPickId: binding.sourcePickId }],
      [{ ...binding, transferId: f.link.custody[0].transferId }],
      [{ ...binding, occurredAt: { precision: 'year', year: 2014 } }],
      [{ ...binding, evidence: [] }],
      [
        {
          ...binding,
          evidence: [{ ...binding.evidence[0], captureId: `source-capture:${'9'.repeat(64)}` }],
        },
      ],
    ]) {
      expect(review(invalid).content.bindingStatus).toBe('blocked');
      expect(review(invalid).content.results[0].proposedResolution).toBeNull();
    }
  });

  it('keeps identity independent of eventual player and distinguishes award components', () => {
    const identity = (f: ReturnType<typeof fixture>) =>
      reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] }).content.results[0]
        .proposedResolution?.entitlementId;
    const original = identity(fixture());
    expect(original).toBeDefined();
    expect(identity(fixture('2010-10-02', 'another-player'))).toBe(original);
    expect(identity(fixture('2010-10-02', 'p', 'CMP2 (Synthetic)'))).not.toBe(original);
  });
  it('maps custody to one proposed right while separating the eventual exercise', () => {
    const f = fixture();
    const resolution = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] }).content
      .results[0].proposedResolution;
    expect(resolution?.entitlementId).toMatch(/^special-draft-entitlement:[a-f0-9]{64}$/);
    expect(resolution?.custody[0].entitlementId).toBe(resolution?.entitlementId);
    expect(resolution?.sourceAsset.draftYear).toBeNull();
    expect(resolution?.retrospectiveExercise.selection.playerId).toBe('p');
    expect(resolution?.retrospectiveExercise.historicalFeatureEligible).toBe(false);
    expect(resolution?.status).toBe('proposed_not_admitted');
  });
  it('keeps right identity stable when date precision changes', () => {
    const f = fixture();
    const first = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] });
    const partial = {
      ...f.link,
      custody: [{ ...f.link.custody[0], occurredAt: { precision: 'year', year: 2010 } }],
    };
    const second = reviewSpecialEntitlementReconciliation({ ...f, links: [partial] });
    expect(second.content.results[0].proposedResolution?.entitlementId).toBe(
      first.content.results[0].proposedResolution?.entitlementId
    );
    expect(second.content.results[0].proposedResolution?.custody[0].occurredAt).toEqual({
      precision: 'year',
      year: 2010,
    });
  });
  it('suppresses every proposed mapping when the submitted set conflicts', () => {
    const f = fixture();
    const report = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link, f.link] });
    expect(report.content.results.every((result) => result.proposedResolution === null)).toBe(true);
    expect(report.content.results[1].issues).toContain('entitlement_claimed_by_multiple_links');
    expect(report.content.results[1].issues).toContain('selection_claimed_by_multiple_rights');
  });
  it('binds year-only custody when the canonical transaction day is unknown', () => {
    const f = fixture(null);
    const link = {
      ...f.link,
      custody: [{ ...f.link.custody[0], occurredAt: { precision: 'year', year: 2010 } }],
    };
    const report = reviewSpecialEntitlementReconciliation({ ...f, links: [link] });
    expect(report.content.bindingStatus).toBe('candidate_bound');
    expect(report.content.promotionEligible).toBe(false);
  });
  it('binds day-only custody without converting it to a midnight event', () => {
    const f = fixture();
    const link = {
      ...f.link,
      custody: [{ ...f.link.custody[0], occurredAt: { precision: 'day', date: '2010-10-02' } }],
    };
    expect(
      reviewSpecialEntitlementReconciliation({ ...f, links: [link] }).content.bindingStatus
    ).toBe('candidate_bound');
  });
  it('rejects the wrong trade year even when the canonical day is unknown', () => {
    const f = fixture(null);
    const link = {
      ...f.link,
      custody: [{ ...f.link.custody[0], occurredAt: { precision: 'year', year: 2011 } }],
    };
    expect(
      reviewSpecialEntitlementReconciliation({ ...f, links: [link] }).content.results[0].issues
    ).toContain('canonical_trade_date_mismatch');
  });
  it('binds source/candidate records without clearing authority or lineage requirements', () => {
    const f = fixture();
    const report = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] });
    expect(report.content.bindingStatus).toBe('candidate_bound');
    expect(report.content).toMatchObject({
      promotionEligible: false,
      authorityVerified: false,
      awardAndActivationClaimsVerified: false,
      persisted: false,
    });
    expect(f.candidate.content.issues.some((issue) => issue.code === 'lineage_unresolved')).toBe(
      true
    );
    expect(reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] }).reviewId).toBe(
      report.reviewId
    );
  });
  it.each([
    [
      'capture_not_bound_to_candidate',
      (f: ReturnType<typeof fixture>) => {
        f.link.award.evidence = [
          { ...f.link.award.evidence[0], captureId: `source-capture:${'5'.repeat(64)}` },
        ];
      },
    ],
    [
      'canonical_trade_date_mismatch',
      (f: ReturnType<typeof fixture>) => {
        f.link.custody[0].occurredAt = '2010-10-03T00:00:00Z';
      },
    ],
    [
      'canonical_transfer_mismatch',
      (f: ReturnType<typeof fixture>) => {
        f.link.custody[0].transferId = 'unknown';
      },
    ],
    [
      'canonical_selection_mismatch',
      (f: ReturnType<typeof fixture>) => {
        f.link.selection.playerId = 'other';
      },
    ],
    [
      'canonical_component_mismatch',
      (f: ReturnType<typeof fixture>) => {
        f.link.asset.sourceLabel = 'CMP2 (Synthetic)';
        f.link.award.component = f.link.asset.sourceLabel;
      },
    ],
  ] as const)('blocks %s', (issue, mutate) => {
    const f = fixture();
    mutate(f);
    const report = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link] });
    expect(report.content.bindingStatus).toBe('blocked');
    expect(report.content.results[0].issues).toContain(issue);
  });
  it('rejects substituted source batches', () => {
    const f = fixture();
    expect(() =>
      reviewSpecialEntitlementReconciliation({ ...f, sourceBatches: [], links: [f.link] })
    ).toThrow('exact candidate source batches');
  });
  it('blocks overlapping custody across links', () => {
    const f = fixture();
    const report = reviewSpecialEntitlementReconciliation({ ...f, links: [f.link, f.link] });
    expect(report.content.bindingStatus).toBe('blocked');
    expect(report.content.results[1].issues).toContain('transfer_claimed_by_multiple_links');
  });
  it('returns the review through the existing command without changing its candidate', async () => {
    const f = fixture();
    const result = await buildAndPersistAflTradeExternalReconciliation(
      { ...f.input, specialEntitlementLinks: [f.link] },
      {
        repository: {
          persistCandidate: async ({ candidate }) => ({
            candidateId: (candidate as typeof f.candidate).candidateId,
            status: 'finalized',
            blockingIssueCount: 1,
            idempotentReplay: false,
          }),
        },
      }
    );
    expect(result.candidateId).toBe(f.candidate.candidateId);
    expect(result.specialEntitlementReview?.content.bindingStatus).toBe('candidate_bound');
    expect(result.publicationEligible).toBe(false);
  });
});

describe('resolved special custody candidates', () => {
  function custodyFixture() {
    const f = fixture(null);
    const award = createSpecialEntitlementAward({
      schemaVersion: 'afl-trade-special-entitlement-award/v1',
      environment: 'test_fixture',
      competition: 'AFLM',
      issuingAwardId: f.link.award.entitlementId,
      component: f.link.award.component,
      asset: f.link.asset,
      holderClubId: f.link.award.holderClubId,
      awardYear: 2010,
      awardedOn: null,
      evidence: f.link.award.evidence,
    });
    const binding = {
      transferId: f.candidate.content.transfers[0]!.transferId,
      award,
      awardApprovalDecisionId: 'reviewed-award',
      predecessorTransferId: null,
    };
    return { ...f, binding };
  }
  it('preserves source identity, source label and an unknown day without importing exercise', () => {
    const f = custodyFixture();
    const resolved = resolveSpecialEntitlementCustody({
      candidate: f.candidate,
      bindings: [f.binding],
      reconciledAt: f.input.reconciledAt,
    });
    expect(resolved.candidateId).not.toBe(f.candidate.candidateId);
    expect(resolved.content.transfers[0]!.asset).toMatchObject({
      kind: 'special_entitlement',
      sourceCandidateId: f.candidate.candidateId,
      entitlementId: f.binding.award.entitlementId,
      sourceAsset: f.link.asset,
      predecessorTransferId: null,
    });
    expect(resolved.content.transactions[0]!.occurredOn).toBeNull();
    expect(
      resolved.content.issues.some(
        (issue) => issue.subjectKey === `lineage:${f.binding.transferId}`
      )
    ).toBe(false);
    expect(f.candidate.content.transfers[0]!.asset.kind).toBe('special_pick');
  });
  it('rejects duplicate bindings, cross-scope awards and self-predecessors', () => {
    const f = custodyFixture();
    for (const bindings of [
      [f.binding, f.binding],
      [{ ...f.binding, predecessorTransferId: f.binding.transferId }],
      [
        {
          ...f.binding,
          award: createSpecialEntitlementAward({
            ...f.binding.award.content,
            competition: 'OTHER',
          }),
        },
      ],
    ]) {
      expect(() =>
        resolveSpecialEntitlementCustody({
          candidate: f.candidate,
          bindings,
          reconciledAt: f.input.reconciledAt,
        })
      ).toThrow();
    }
  });
  it('persists the source before the resolved candidate through the existing command', async () => {
    const f = custodyFixture();
    const saved: unknown[] = [];
    const result = await buildAndPersistAflTradeExternalReconciliation(
      { ...f.input, specialEntitlementAwardBindings: [f.binding] },
      {
        repository: {
          async persistCandidate({ candidate: unparsedCandidate }) {
            const candidate = parseAflTradeExternalReconciliationCandidate(unparsedCandidate);
            saved.push(candidate);
            return {
              candidateId: candidate.candidateId,
              status: 'finalized' as const,
              idempotentReplay: false,
              transactionCount: candidate.content.transactions.length,
              transferCount: candidate.content.transfers.length,
              draftSelectionCount: candidate.content.draftSelections.length,
              pickCustodyCount: candidate.content.pickCustody.length,
              pickLineageCount: candidate.content.pickLineage.length,
              issueCount: candidate.content.issues.length,
              blockingIssueCount: candidate.content.issues.filter(
                (issue) => issue.severity === 'blocking'
              ).length,
            };
          },
        },
      }
    );
    expect(saved).toHaveLength(2);
    expect(result.sourceCandidateId).toBe(f.candidate.candidateId);
    expect(result.candidateId).not.toBe(f.candidate.candidateId);
  });
});
