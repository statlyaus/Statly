import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';

const identity = z.string().min(1).max(240);
const date = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('year'), year: z.number().int().min(1897).max(2200) }).strict(),
  z.object({ precision: z.literal('day'), eventDate: z.iso.date() }).strict(),
]);

/** Reviewed factual input only. A proposal ID is never a canonical event or promotion ID. */
export const reviewedPlayerDepartureInputSchema = z
  .object({
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    acquisitionAssetVersionId: identity,
    playerId: identity,
    fromClubId: identity,
    toClubId: z.null(),
    departureDate: date,
    reason: z.enum(['delisting', 'contract_release', 'resignation']),
    membershipEvidence: z.literal('explicit_club_departure'),
    evidence: z.array(aflTradeArtifactRefSchema).min(1).max(50),
    recordedAt: z.iso.datetime({ precision: 3 }),
  })
  .strict()
  .superRefine((input, context) => {
    const lastDate =
      input.departureDate.precision === 'day'
        ? input.departureDate.eventDate
        : `${input.departureDate.year}-12-31`;
    if (lastDate > input.recordedAt.slice(0, 10)) {
      context.addIssue({
        code: 'custom',
        message: 'Departure bounds extend beyond recording time.',
      });
    }
    for (const [index, ref] of input.evidence.entries()) {
      if (
        Date.parse(ref.createdAt) > Date.parse(input.recordedAt) ||
        (index > 0 && input.evidence[index - 1]!.artifactId >= ref.artifactId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Evidence must precede recording and be unique and ordered.',
        });
      }
    }
  });

export type ReviewedPlayerDepartureInput = z.infer<typeof reviewedPlayerDepartureInputSchema>;

export function prepareReviewedPlayerDeparture(input: unknown) {
  const parsed = reviewedPlayerDepartureInputSchema.parse(input);
  const content = {
    schemaVersion: 'afl-trade-reviewed-player-departure/v1' as const,
    ...parsed,
    eventKind: 'player_departure' as const,
  };
  return {
    proposalId: createAflTradeContentAddress('reviewed-player-departure', content),
    content,
    canonicalEventVersionId: null,
    canonicalAssetVersionId: null,
    promotionId: null,
    status: 'prepared_not_promoted' as const,
  };
}
