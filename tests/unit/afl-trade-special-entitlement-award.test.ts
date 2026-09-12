import { describe, expect, it } from 'vitest';
import {
  createSpecialEntitlementAward,
  specialEntitlementAwardSchema,
} from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import { parseSpecialDraftEntitlement } from '@/server/aflTradeIntelligence/source/specialDraftEntitlement';

const base = {
  schemaVersion: 'afl-trade-special-entitlement-award/v1' as const,
  environment: 'test_fixture' as const,
  competition: 'AFLM',
  issuingAwardId: 'afl:expansion-award',
  component: 'CMP3 (Campbell Brown)',
  asset: parseSpecialDraftEntitlement('CMP3 (Campbell Brown)', 2010)!,
  holderClubId: 'club-hawthorn',
  awardYear: 2010,
  awardedOn: null,
  evidence: [
    {
      captureId: `source-capture:${'a'.repeat(64)}`,
      contentSha256: 'b'.repeat(64),
      sourceUrl: 'https://www.afl.com.au/award',
    },
  ],
};

describe('special entitlement issuing awards', () => {
  it('stores an unactivated award without a draft year, activation or player', () => {
    const award = createSpecialEntitlementAward(base);
    expect(award.content.asset.draftYear).toBeNull();
    expect(award.content.awardedOn).toBeNull();
    expect(
      specialEntitlementAwardSchema.safeParse({
        ...award,
        content: { ...award.content, playerId: 'future-player' },
      }).success
    ).toBe(false);
  });
  it('keeps identity stable when date precision improves and separates award components', () => {
    expect(createSpecialEntitlementAward({ ...base, awardedOn: '2010-10-01' }).entitlementId).toBe(
      createSpecialEntitlementAward(base).entitlementId
    );
    const component = 'CMP2 (Gary Ablett)';
    expect(
      createSpecialEntitlementAward({
        ...base,
        component,
        asset: parseSpecialDraftEntitlement(component, 2010)!,
      }).entitlementId
    ).not.toBe(createSpecialEntitlementAward(base).entitlementId);
  });
  it('rejects a substituted identity, date year and invented activation year', () => {
    const award = createSpecialEntitlementAward(base);
    expect(() =>
      specialEntitlementAwardSchema.parse({
        ...award,
        entitlementId: `special-draft-entitlement:${'f'.repeat(64)}`,
      })
    ).toThrow();
    expect(() => createSpecialEntitlementAward({ ...base, awardedOn: '2011-01-01' })).toThrow();
    expect(() =>
      createSpecialEntitlementAward({ ...base, asset: { ...base.asset, draftYear: 2014 } })
    ).toThrow();
  });
  it('rejects duplicate or conflicting references to the same capture', () => {
    expect(() =>
      createSpecialEntitlementAward({ ...base, evidence: [...base.evidence, ...base.evidence] })
    ).toThrow();
    expect(() =>
      createSpecialEntitlementAward({
        ...base,
        evidence: [...base.evidence, { ...base.evidence[0]!, contentSha256: 'c'.repeat(64) }],
      })
    ).toThrow();
  });
});
