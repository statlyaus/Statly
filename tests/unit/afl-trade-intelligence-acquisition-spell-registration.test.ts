import { describe, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  aflTradeAcquisitionSpellRegistrationSchema,
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
  deriveAflTradeAcquisitionMembershipBounds,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';

const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticRecruitmentNotice: 'Player joins club on 2024-11-20' },
  '2026-09-10T00:00:00.000Z'
);
const ruleInput = {
  environment: 'non_production' as const,
  competition: 'AFLM' as const,
  ruleVersion: 'synthetic-reviewed-entry-v1',
  createdAt: '2026-09-10T00:00:01.000Z',
  evidence: [evidence],
};
const entry = {
  promotionId: 'external-canonical-promotion:' + 'a'.repeat(64),
  eventVersionId: 'event-version:entry',
  assetVersionId: 'asset-version:entry',
  eventDate: '2024-11-20',
  evidence: [evidence],
};

function spellInput() {
  return {
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    playerId: 'player:one',
    clubId: 'club:one',
    entry,
    departure: null,
    ruleId: createAflTradeAcquisitionSpellRegistrationRule(ruleInput).ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [evidence],
    createdAt: '2026-09-10T00:00:02.000Z',
  };
}

describe('reviewed acquisition registration contracts', () => {
  it('addresses the complete evidence-backed record and preserves dates rather than deriving them from appearances', () => {
    const record = createAflTradeAcquisitionSpellRegistration(spellInput());
    expect(record.content.entry.eventDate).toBe('2024-11-20');
    expect(record.content.departure).toBeNull();
    expect(aflTradeAcquisitionSpellRegistrationSchema.parse(record)).toEqual(record);
    const changed = createAflTradeAcquisitionSpellRegistration({
      ...spellInput(),
      observedThrough: '2025-09-28',
    });
    expect(changed.spellVersionId).not.toBe(record.spellVersionId);
    expect(() =>
      aflTradeAcquisitionSpellRegistrationSchema.parse({
        ...record,
        content: changed.content,
      })
    ).toThrow();
  });
  it.each([
    { entry: { ...entry, eventDate: '2026-09-11' } },
    { departure: { ...entry, eventDate: '2024-11-19' } },
    { observedThrough: '2024-11-19' },
    { observedThrough: '2026-09-11' },
    { version: 2 },
    { supersedesSpellVersionId: 'acquisition-spell-version:' + 'b'.repeat(64) },
    { createdAt: '2026-09-09T00:00:00.000Z' },
  ])('rejects impossible chronology or incomplete version ancestry %#', (change) => {
    expect(() =>
      createAflTradeAcquisitionSpellRegistration({ ...spellInput(), ...change })
    ).toThrow();
  });
  it('rejects duplicated evidence instead of giving it extra authority', () => {
    expect(() =>
      createAflTradeAcquisitionSpellRegistrationRule({
        ...ruleInput,
        evidence: [evidence, evidence],
      })
    ).toThrow();
  });
});

const windowEntry = {
  ...entry,
  eventDate: null,
  datePrecision: {
    precision: 'window' as const,
    eventDate: null,
    earliestDate: '2024-11-20',
    latestDate: '2024-11-25',
  },
};
function windowInput() {
  return {
    ...spellInput(),
    entry: windowEntry,
    ruleId: createAflTradeWindowAcquisitionSpellRegistrationRule(ruleInput).ruleId,
  };
}
it('preserves window precision and separates possible from certain membership', () => {
  const record = createAflTradeWindowAcquisitionSpellRegistration(windowInput());
  expect(record.content.entry).toEqual(windowEntry);
  expect(aflTradeAcquisitionSpellRegistrationSchema.parse(record)).toEqual(record);
  expect(deriveAflTradeAcquisitionMembershipBounds(record)).toEqual({
    exactStartDate: null,
    exactEndDate: null,
    observedThrough: '2025-09-27',
    possible: { startDate: '2024-11-20', endDate: '2025-09-27' },
    certain: { startDate: '2024-11-25', endDate: '2025-09-27' },
  });
  expect(() => createAflTradeAcquisitionSpellRegistration(windowInput() as never)).toThrow();
});
it('excludes the departure day and preserves uncertainty at both boundaries', () => {
  const record = createAflTradeWindowAcquisitionSpellRegistration({
    ...windowInput(),
    departure: {
      ...windowEntry,
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2025-02-28',
        latestDate: '2025-03-02',
      },
    },
  });
  expect(deriveAflTradeAcquisitionMembershipBounds(record)).toMatchObject({
    exactStartDate: null,
    exactEndDate: null,
    possible: { startDate: '2024-11-20', endDate: '2025-03-01' },
    certain: { startDate: '2024-11-25', endDate: '2025-02-27' },
  });
  const exact = createAflTradeAcquisitionSpellRegistration({
    ...spellInput(),
    departure: { ...entry, eventDate: '2024-03-01' },
    entry: { ...entry, eventDate: '2024-02-01' },
  });
  expect(deriveAflTradeAcquisitionMembershipBounds(exact)).toMatchObject({
    exactStartDate: '2024-02-01',
    exactEndDate: '2024-02-29',
    possible: { startDate: '2024-02-01', endDate: '2024-02-29' },
    certain: { startDate: '2024-02-01', endDate: '2024-02-29' },
  });
});
it('rejects overlapping windows, false precision, future bounds and altered content addresses', () => {
  for (const change of [
    { entry: { ...windowEntry, eventDate: '2024-11-25' } },
    { entry: { ...windowEntry, datePrecision: undefined } },
    { observedThrough: '2024-11-24' },
    { departure: { ...entry, eventDate: '2024-11-25' } },
    {
      departure: {
        ...windowEntry,
        datePrecision: {
          ...windowEntry.datePrecision,
          earliestDate: '2024-11-24',
          latestDate: '2024-11-28',
        },
      },
    },
    { entry },
  ])
    expect(() =>
      createAflTradeWindowAcquisitionSpellRegistration({ ...windowInput(), ...change } as never)
    ).toThrow();
  const first = createAflTradeWindowAcquisitionSpellRegistration(windowInput());
  const changed = createAflTradeWindowAcquisitionSpellRegistration({
    ...windowInput(),
    entry: {
      ...windowEntry,
      datePrecision: { ...windowEntry.datePrecision, latestDate: '2024-11-26' },
    },
  });
  expect(changed.spellVersionId).not.toBe(first.spellVersionId);
  expect(() =>
    aflTradeAcquisitionSpellRegistrationSchema.parse({ ...first, content: changed.content })
  ).toThrow();
});
