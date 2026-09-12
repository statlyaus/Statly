import { createSpecialEntitlementIdentityReplacement, inspectSpecialEntitlementIdentityReplacement, specialEntitlementIdentityReplacementSchema } from '@/server/aflTradeIntelligence/source/specialEntitlementIdentityReplacementContracts';
import { describe, expect, it } from 'vitest';
import { createSpecialEntitlementAward } from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import {
  createSpecialEntitlementRevision,
  specialEntitlementRevisionSchema,
  validateSpecialEntitlementRevisionSuccessor,
} from '@/server/aflTradeIntelligence/source/specialEntitlementRevisionContracts';

function fixture() {
  const award = createSpecialEntitlementAward({
    schemaVersion: 'afl-trade-special-entitlement-award/v1',
    environment: 'test_fixture',
    competition: 'AFLM',
    issuingAwardId: 'fixture-award',
    component: 'M1',
    asset: {
      kind: 'special_pick',
      entitlementType: 'mini_draft',
      draftYear: 2011,
      selectionOrdinal: 1,
      sourceLabel: 'M1',
    },
    holderClubId: 'gws',
    awardYear: 2011,
    awardedOn: null,
    evidence: [
      {
        captureId: `source-capture:${'1'.repeat(64)}`,
        contentSha256: '2'.repeat(64),
        sourceUrl: 'https://example.test/award',
      },
    ],
  });
  return createSpecialEntitlementRevision({
    schemaVersion: 'afl-trade-special-entitlement-revision/v1',
    entitlementId: award.entitlementId,
    revision: 1,
    supersedesRevisionId: null,
    reason: 'Retain original admitted state',
    changedFields: [],
    proposedAt: '2026-09-12T00:00:00Z',
    state: {
      award: { award, approvalDecisionId: 'award-review' },
      custody: [
        {
          transferId: `external-transfer:${'3'.repeat(64)}`,
          assetVersionId: 'asset-v1',
          eventVersionId: 'event-v1',
          predecessorTransferId: null,
          fromClubId: 'gws',
          toClubId: 'gc',
          seasonYear: 2011,
          occurredOn: null,
        },
      ],
      activation: null,
      exercise: null,
    },
  });
}
function corrected() {
  const before = fixture();
  const award = createSpecialEntitlementAward({
    ...before.content.state.award.award.content,
    awardedOn: '2011-01-12',
  });
  const after = createSpecialEntitlementRevision({
    ...before.content,
    revision: 2,
    supersedesRevisionId: before.revisionId,
    reason: 'Reviewed evidence establishes the award day',
    changedFields: ['award'],
    state: {
      ...before.content.state,
      award: { award, approvalDecisionId: 'corrected-award-review' },
    },
  });
  return { before, after };
}
describe('special entitlement correction revisions', () => {
  it('preserves the original right and unknown custody date while adding reviewed award precision', () => {
    const { before, after } = corrected();
    expect(validateSpecialEntitlementRevisionSuccessor(before, after)).toMatchObject({
      changedFields: ['award'],
      authorityVerified: false,
      promotionEligible: false,
    });
    expect(after.content.entitlementId).toBe(before.content.entitlementId);
    expect(before.content.state.award.award.content.awardedOn).toBeNull();
    expect(after.content.state.custody[0]!.occurredOn).toBeNull();
  });
  it('rejects a stale predecessor, skipped revision and backwards proposal time', () => {
    const { before, after } = corrected();
    for (const change of [
      { supersedesRevisionId: `special-entitlement-revision:${'f'.repeat(64)}` },
      { revision: 3 },
      { proposedAt: '2025-09-12T00:00:00Z' },
    ]) {
      expect(() =>
        validateSpecialEntitlementRevisionSuccessor(
          before,
          createSpecialEntitlementRevision({ ...after.content, ...change })
        )
      ).toThrow(/exact predecessor/);
    }
  });
  it('rejects a renamed identity even when its new content address is internally valid', () => {
    const { before, after } = corrected();
    const award = createSpecialEntitlementAward({
      ...after.content.state.award.award.content,
      issuingAwardId: 'another-award',
    });
    const renamed = createSpecialEntitlementRevision({
      ...after.content,
      entitlementId: award.entitlementId,
      state: { ...after.content.state, award: { ...after.content.state.award, award } },
    });
    expect(() => validateSpecialEntitlementRevisionSuccessor(before, renamed)).toThrow(
      /same right/
    );
  });
  it('rejects hidden changes, no-op successors and altered content under an old digest', () => {
    const { before, after } = corrected();
    expect(() =>
      validateSpecialEntitlementRevisionSuccessor(
        before,
        createSpecialEntitlementRevision({ ...after.content, changedFields: ['custody'] })
      )
    ).toThrow(/exact changed fields/);
    expect(() =>
      validateSpecialEntitlementRevisionSuccessor(
        before,
        createSpecialEntitlementRevision({ ...after.content, state: before.content.state })
      )
    ).toThrow(/no-op/);
    expect(
      specialEntitlementRevisionSchema.safeParse({
        ...after,
        content: { ...after.content, reason: 'tampered' },
      }).success
    ).toBe(false);
  });
  it('rejects a holder correction that fails to replace its dependent custody state', () => {
    const { before, after } = corrected();
    const award = createSpecialEntitlementAward({
      ...after.content.state.award.award.content,
      holderClubId: 'different-club',
    });
    expect(() =>
      createSpecialEntitlementRevision({
        ...after.content,
        state: { ...before.content.state, award: { ...after.content.state.award, award } },
      })
    ).toThrow(/continuous ordered holder chain/);
  });
  it('rejects exercise tied to a nonterminal transfer and an impossible custody date', () => {
    const before = fixture();
    const exercise = {
      record: {
        schemaVersion: 'afl-trade-special-entitlement-lifecycle/v1' as const,
        kind: 'exercise' as const,
        entitlementId: before.content.entitlementId,
        selectionId: 'selection',
        terminalTransferId: `external-transfer:${'4'.repeat(64)}`,
        evidence: before.content.state.award.award.content.evidence,
      },
      approvalDecisionId: 'exercise-review',
    };
    expect(() =>
      createSpecialEntitlementRevision({
        ...before.content,
        state: { ...before.content.state, exercise },
      })
    ).toThrow(/terminal custody/);
    expect(() =>
      createSpecialEntitlementRevision({
        ...before.content,
        state: {
          ...before.content.state,
          custody: [{ ...before.content.state.custody[0]!, seasonYear: 2010 }],
        },
      })
    ).toThrow(/chronology/);
  });
});

describe('explicit special entitlement identity replacement', () => {
  function replacementFixture() {
    const before = fixture();
    const award = createSpecialEntitlementAward({
      ...before.content.state.award.award.content, issuingAwardId: 'corrected-issuing-award',
    });
    const initial = createSpecialEntitlementRevision({
      ...before.content, entitlementId: award.entitlementId,
      state: { award: { award, approvalDecisionId: 'replacement-award-review' }, custody: [], activation: null, exercise: null },
    });
    const after = createSpecialEntitlementRevision({
      ...initial.content, revision: 2, supersedesRevisionId: initial.revisionId, changedFields: ['custody'],
      state: { ...initial.content.state, custody: before.content.state.custody.map((edge) => ({ ...edge, assetVersionId: 'replacement-asset', eventVersionId: 'replacement-event-version' })) },
    });
    return { schemaVersion: 'afl-trade-special-entitlement-identity-replacement/v1' as const,
      retiredRevision: before, replacementRevision: after, reason: 'Correct the issuing award identity',
      evidence: award.content.evidence, proposedAt: '2026-09-12T00:00:01Z' };
  }
  it('accepts an exact award-only replacement without invented custody or a no-op successor', () => {
    const input = replacementFixture();
    const retiredRevision = createSpecialEntitlementRevision({ ...input.retiredRevision.content,
      state: { ...input.retiredRevision.content.state, custody: [] } });
    const replacementRevision = createSpecialEntitlementRevision({ ...input.replacementRevision.content,
      revision: 1, supersedesRevisionId: null, changedFields: [],
      state: { ...input.replacementRevision.content.state, custody: [] } });
    expect(createSpecialEntitlementIdentityReplacement({ ...input, retiredRevision, replacementRevision }).content.replacementRevision.content.revision).toBe(1);
  });
  it('binds both complete states without granting authority or retiring the old identity', () => {
    const content = replacementFixture();
    const replacement = createSpecialEntitlementIdentityReplacement(content);
    expect(inspectSpecialEntitlementIdentityReplacement(replacement)).toEqual({
      replacement, authorityVerified: false, promotionEligible: false, oldIdentityRetired: false,
    });
    expect(createSpecialEntitlementIdentityReplacement(content)).toEqual(replacement);
    expect(() => specialEntitlementIdentityReplacementSchema.parse({
      ...replacement, content: { ...content, reason: 'Unreviewed change' },
    })).toThrow();
  });
  it('rejects same-identity replacement, omitted custody, reused assets and backdated review', () => {
    const content = replacementFixture();
    expect(() => createSpecialEntitlementIdentityReplacement({ ...content, replacementRevision: content.retiredRevision })).toThrow();
    for (const custody of [[], content.retiredRevision.content.state.custody]) {
      const after = createSpecialEntitlementRevision({ ...content.replacementRevision.content,
        state: { ...content.replacementRevision.content.state, custody } });
      expect(() => createSpecialEntitlementIdentityReplacement({ ...content, replacementRevision: after })).toThrow();
    }
    expect(() => createSpecialEntitlementIdentityReplacement({ ...content, proposedAt: '2026-09-11T00:00:00Z' })).toThrow();
    expect(() => createSpecialEntitlementIdentityReplacement({ ...content, evidence: [...content.evidence, ...content.evidence] })).toThrow();
  });
});
