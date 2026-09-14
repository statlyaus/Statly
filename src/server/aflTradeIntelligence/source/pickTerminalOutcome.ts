import { z } from 'zod';

import { nonPlayerPickOutcomeSchema } from './nonPlayerPickOutcome';

/** A player-bearing endpoint; it does not imply a national draft selection. */
export const rookieElevationOutcomeSchema = z
  .object({
    kind: z.literal('rookie_elevation'),
    playerId: z.string().trim().min(1).max(240),
    recordedPlayerName: z.string().trim().min(1).max(240),
    exercisingClubId: z.string().trim().min(1).max(240),
    draftYear: z.number().int().min(1988).max(2200),
    draftType: z.string().trim().min(1).max(80),
    livePick: z.number().int().positive(),
  })
  .strict();

/** Trade-time pick numbering belongs to the evidenced transfer and custody history. */
export const pickTerminalOutcomeSchema = z.discriminatedUnion('kind', [
  ...nonPlayerPickOutcomeSchema.options,
  rookieElevationOutcomeSchema,
]);

export type PickTerminalOutcome = z.infer<typeof pickTerminalOutcomeSchema>;
