// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAflTradeByteArtifactRef } from '../../src/server/aflTradeIntelligence/artifacts/artifactReference';
import { prepareReviewedPlayerDeparture } from '../../src/server/aflTradeIntelligence/source/reviewedPlayerDeparture';
const input = () => ({
  environment: 'non_production',
  competition: 'AFLM',
  acquisitionAssetVersionId: 'asset:fixture',
  playerId: 'player:fixture',
  fromClubId: 'club:fixture',
  toClubId: null,
  departureDate: { precision: 'year', year: 2012 },
  reason: 'delisting',
  membershipEvidence: 'explicit_club_departure',
  evidence: [
    createAflTradeByteArtifactRef(
      Buffer.from('explicit departure fixture'),
      'text/plain',
      '2026-09-14T00:00:00.000Z'
    ),
  ],
  recordedAt: '2026-09-14T01:00:00.000Z',
});
describe('reviewed one-sided player departures', () => {
  it('preserves year precision and never grants canonical status', () => {
    const result = prepareReviewedPlayerDeparture(input());
    expect(result.content.departureDate).toEqual({ precision: 'year', year: 2012 });
    expect(result.content.toClubId).toBeNull();
    expect(result.canonicalEventVersionId).toBeNull();
    expect(result.promotionId).toBeNull();
    expect(result.status).toBe('prepared_not_promoted');
    expect(prepareReviewedPlayerDeparture(input())).toEqual(result);
  });
  it.each(['retirement', 'nonparticipation', 'trade'])('rejects unsupported %s reason', (reason) =>
    expect(() => prepareReviewedPlayerDeparture({ ...input(), reason })).toThrow()
  );
  it.each([
    { toClubId: 'club:invented' },
    { playerId: '' },
    { evidence: [] },
    { membershipEvidence: 'no_appearances' },
    { departureDate: { precision: 'year', year: 2027 } },
    { recordedAt: '2026-09-13T00:00:00.000Z' },
    { environment: 'production' },
  ])('rejects invalid identity, chronology, authority scope or evidence %j', (change) => {
    expect(() => prepareReviewedPlayerDeparture({ ...input(), ...change })).toThrow();
  });
  it('rejects duplicate evidence', () => {
    const value = input();
    value.evidence.push(value.evidence[0]!);
    expect(() => prepareReviewedPlayerDeparture(value)).toThrow();
  });
  it('keeps evidenced exact dates and changes the proposal when the fact changes', () => {
    const value = { ...input(), departureDate: { precision: 'day', eventDate: '2012-10-31' } };
    expect(prepareReviewedPlayerDeparture(value).content.departureDate).toEqual(
      value.departureDate
    );
    expect(prepareReviewedPlayerDeparture(value).proposalId).not.toBe(
      prepareReviewedPlayerDeparture(input()).proposalId
    );
  });
});
