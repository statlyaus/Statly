import { describe, expect, it } from 'vitest';
import { specialEntitlementLifecycleSchema } from '@/server/aflTradeIntelligence/source/specialEntitlementLifecycleContracts';

const activation = {
  schemaVersion: 'afl-trade-special-entitlement-lifecycle/v1',
  kind: 'activation',
  entitlementId: `special-draft-entitlement:${'1'.repeat(64)}`,
  useYear: 2013,
  noticeYear: 2013,
  noticedOn: null,
  expiresAfterYear: 2015,
  rule: 'deferred_nomination',
  evidence: [
    {
      captureId: `source-capture:${'2'.repeat(64)}`,
      contentSha256: '3'.repeat(64),
      sourceUrl: 'https://example.test/rules',
    },
  ],
};
describe('special entitlement lifecycle boundary', () => {
  it('preserves a known use year without assigning a notice day or selected player', () => {
    expect(specialEntitlementLifecycleSchema.parse(activation)).toEqual(activation);
    expect(
      specialEntitlementLifecycleSchema.parse({ ...activation, noticeYear: null })
    ).toMatchObject({ noticeYear: null, noticedOn: null });
    expect(
      specialEntitlementLifecycleSchema.safeParse({ ...activation, playerId: 'future-player' })
        .success
    ).toBe(false);
  });
  it('rejects notice/use-year contradictions and exercise beyond the reviewed expiry', () => {
    for (const change of [
      { noticedOn: '2012-03-01' },
      { noticeYear: 2014 },
      { expiresAfterYear: 2012 },
    ]) {
      expect(
        specialEntitlementLifecycleSchema.safeParse({ ...activation, ...change }).success
      ).toBe(false);
    }
  });
  it('requires canonical exercise references rather than a guessed pick or player', () => {
    const record = {
      schemaVersion: activation.schemaVersion,
      kind: 'exercise',
      entitlementId: activation.entitlementId,
      evidence: activation.evidence,
      selectionId: 'canonical-selection',
      terminalTransferId: `external-transfer:${'4'.repeat(64)}`,
    };
    expect(specialEntitlementLifecycleSchema.parse(record)).toEqual(record);
    expect(
      specialEntitlementLifecycleSchema.safeParse({
        ...record,
        selectionId: undefined,
        nominalPick: 9,
      }).success
    ).toBe(false);
  });
});
