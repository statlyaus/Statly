import { describe, expect, it } from 'vitest';
import {
  NONPARTICIPANT_LOCATED_EVIDENCE_FROM,
  nonparticipantEvidenceRequiringLocation,
} from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';

const review = (decidedAt: string, artifactId: string) => ({
  review: { decidedAt, evidenceArtifact: { artifactId } },
});

describe('nonparticipantEvidenceRequiringLocation', () => {
  it('requires a location only for reviews decided from the cutoff on', () => {
    expect(NONPARTICIPANT_LOCATED_EVIDENCE_FROM).toBe('2026-10-06T00:00:00.000Z');
    expect(
      nonparticipantEvidenceRequiringLocation([
        // The genuine 2025 reviews whose pages were lost predate store locations.
        review('2026-10-02T03:14:15.000Z', 'artifact:before'),
        review('2026-10-05T23:59:59.999Z', 'artifact:just-before'),
        review('2026-10-06T00:00:00.000Z', 'artifact:at-cutoff'),
        // 09:00 on 7 October at +10:00 is 23:00 UTC on 6 October: after the cutoff.
        review('2026-10-07T09:00:00.000+10:00', 'artifact:after-in-another-offset'),
        // 09:00 on 6 October at +10:00 is 23:00 UTC on 5 October: before the cutoff.
        review('2026-10-06T09:00:00.000+10:00', 'artifact:before-in-another-offset'),
      ])
    ).toEqual(['artifact:at-cutoff', 'artifact:after-in-another-offset']);
    expect(
      nonparticipantEvidenceRequiringLocation([
        review('2026-10-07T00:00:00.000Z', 'artifact:later'),
      ])
    ).toEqual(['artifact:later']);
  });
});
