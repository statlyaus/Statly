import { it, expect } from 'vitest';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createCanonicalPlayerDeparture,
  canonicalPlayerDepartureSchema,
  canonicalDepartureSpellBinding,
} from '@/server/aflTradeIntelligence/source/canonicalPlayerDeparture';
import {
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
  deriveAflTradeAcquisitionMembershipBounds,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
const ref = createAflTradeByteArtifactRef(
  Buffer.from('synthetic departure'),
  'text/plain',
  '2026-09-15T00:00:00.000Z'
);
const input = () => ({
  environment: 'test_fixture' as const,
  competition: 'AFLM' as const,
  playerId: 'player:test',
  fromClubId: 'club:test',
  toClubId: null,
  acquisition: {
    promotionId: 'external-canonical-promotion:' + 'a'.repeat(64),
    eventVersionId: 'event:test',
    assetVersionId: 'asset:test',
    eventDate: '2010-10-15',
    evidence: [ref],
  },
  departureYear: 2012,
  reason: 'delisting' as const,
  recordedPlayer: 'Synthetic Player',
  recordedClub: 'Synthetic Club',
  sourceEvidenceId: 'external-evidence:' + 'b'.repeat(64),
  sourceBatchId: 'external-evidence-batch:' + 'c'.repeat(64),
  evidence: [ref],
  createdAt: '2026-09-15T00:00:01.000Z',
});
it('retains explicit year bounds and canonical identity without inventing an outgoing trade', () => {
  const event = createCanonicalPlayerDeparture(input());
  expect(createCanonicalPlayerDeparture(input())).toEqual(event);
  const binding = canonicalDepartureSpellBinding(event);
  expect(binding).toMatchObject({
    departureEventId: event.departureEventId,
    eventDate: null,
    datePrecision: { earliestDate: '2012-01-01', latestDate: '2012-12-31' },
  });
  expect(() =>
    canonicalPlayerDepartureSchema.parse({
      ...event,
      content: { ...event.content, recordedClub: 'Changed' },
    })
  ).toThrow('address');
  const rule = createAflTradeWindowAcquisitionSpellRegistrationRule({
    environment: 'test_fixture',
    competition: 'AFLM',
    ruleVersion: 'fixture',
    evidence: [ref],
    createdAt: '2026-09-15T00:00:02.000Z',
  });
  const spell = createAflTradeWindowAcquisitionSpellRegistration({
    environment: 'test_fixture',
    competition: 'AFLM',
    playerId: event.content.playerId,
    clubId: event.content.fromClubId,
    entry: event.content.acquisition,
    departure: binding,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2013-12-31',
    continuityEvidence: [ref],
    createdAt: '2026-09-15T00:00:03.000Z',
  });
  expect(deriveAflTradeAcquisitionMembershipBounds(spell)).toMatchObject({
    exactEndDate: null,
    possible: { endDate: '2012-12-30' },
    certain: { endDate: '2011-12-31' },
  });
});
it.each([
  { departureYear: 2010 },
  { departureYear: 2027 },
  { recordedPlayer: '' },
  { evidence: [] },
  { toClubId: 'club:invented' },
  { reason: 'retirement' },
  { createdAt: '2026-09-14T00:00:00.000Z' },
])('rejects unsupported chronology, identity or departure evidence %j', (change) => {
  expect(() =>
    createCanonicalPlayerDeparture({ ...input(), ...change } as Parameters<
      typeof createCanonicalPlayerDeparture
    >[0])
  ).toThrow();
});
