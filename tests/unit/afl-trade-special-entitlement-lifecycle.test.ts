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
  it('retains partial renumbering dates and requires bound, nonconflicting evidence', () => {
    const binding = {
      transferId: `external-transfer:${'4'.repeat(64)}`,
      sourcePickId: `draft-pick:${'5'.repeat(64)}`,
      targetPickId: `draft-pick:${'6'.repeat(64)}`,
      occurredAt: { precision: 'year', year: 2013 },
      evidenceCaptureIds: [activation.evidence[0].captureId],
    };
    const exercise = {
      schemaVersion: activation.schemaVersion,
      kind: 'exercise',
      entitlementId: activation.entitlementId,
      evidence: activation.evidence,
      selectionId: 'canonical-selection',
      terminalTransferId: binding.transferId,
      renumbering: [binding],
    };
    expect(specialEntitlementLifecycleSchema.parse(exercise)).toEqual(exercise);
    expect(
      specialEntitlementLifecycleSchema.parse({
        ...exercise,
        renumbering: [{ ...binding, occurredAt: { precision: 'day', date: '2013-11-20' } }],
      })
    ).toMatchObject({
      renumbering: [{ occurredAt: { precision: 'day', date: '2013-11-20' } }],
    });
    for (const renumbering of [
      [],
      [binding, binding],
      [{ ...binding, targetPickId: binding.sourcePickId }],
      [{ ...binding, occurredAt: { precision: 'year', year: 1800 } }],
      [{ ...binding, evidenceCaptureIds: [] }],
      [
        {
          ...binding,
          evidenceCaptureIds: [activation.evidence[0].captureId, activation.evidence[0].captureId],
        },
      ],
      [{ ...binding, evidenceCaptureIds: [`source-capture:${'9'.repeat(64)}`] }],
      [
        binding,
        {
          ...binding,
          transferId: `external-transfer:${'8'.repeat(64)}`,
          targetPickId: `draft-pick:${'7'.repeat(64)}`,
        },
      ],
    ])
      expect(
        specialEntitlementLifecycleSchema.safeParse({ ...exercise, renumbering }).success
      ).toBe(false);
    expect(
      specialEntitlementLifecycleSchema.safeParse({ ...activation, renumbering: [binding] }).success
    ).toBe(false);
  });

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
