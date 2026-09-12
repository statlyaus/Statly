import { describe, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  aflTradeAcquisitionSpellRegistrationSchema,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';

const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticRecruitmentNotice: 'Player joins club on 2024-11-20' },
  '2026-09-10T00:00:00.000Z'
);
const ruleInput = {
  environment: 'non_production' as const, competition: 'AFLM' as const,
  ruleVersion: 'synthetic-reviewed-entry-v1', createdAt: '2026-09-10T00:00:01.000Z',
  evidence: [evidence],
};
const entry = {
  promotionId: 'external-canonical-promotion:' + 'a'.repeat(64),
  eventVersionId: 'event-version:entry', assetVersionId: 'asset-version:entry',
  eventDate: '2024-11-20', evidence: [evidence],
};

function spellInput() {
  return {
    environment: 'non_production' as const, competition: 'AFLM' as const,
    playerId: 'player:one', clubId: 'club:one', entry, departure: null,
    ruleId: createAflTradeAcquisitionSpellRegistrationRule(ruleInput).ruleId,
    version: 1, supersedesSpellVersionId: null,
    observedThrough: '2025-09-27', continuityEvidence: [evidence],
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
      ...spellInput(), observedThrough: '2025-09-28',
    });
    expect(changed.spellVersionId).not.toBe(record.spellVersionId);
    expect(() => aflTradeAcquisitionSpellRegistrationSchema.parse({
      ...record, content: changed.content,
    })).toThrow();
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
    expect(() => createAflTradeAcquisitionSpellRegistration({ ...spellInput(), ...change })).toThrow();
  });
  it('rejects duplicated evidence instead of giving it extra authority', () => {
    expect(() => createAflTradeAcquisitionSpellRegistrationRule({ ...ruleInput,
      evidence: [evidence, evidence],
    })).toThrow();
  });

});
