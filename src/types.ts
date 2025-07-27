import { z } from 'zod';

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  position: z.string(),
  avg: z.number(),
  kicks: z.number().nullable().optional(),
  kicks_rank: z.number().nullable().optional(),
  handballs: z.number().nullable().optional(),
  handballs_rank: z.number().nullable().optional(),
  marks: z.number().nullable().optional(),
  marks_rank: z.number().nullable().optional(),
  tackles: z.number().nullable().optional(),
  tackles_rank: z.number().nullable().optional(),
  goals: z.number().nullable().optional(),
  goals_rank: z.number().nullable().optional(),
  hitouts: z.number().nullable().optional(),
  hitouts_rank: z.number().nullable().optional(),
  clearances: z.number().nullable().optional(),
  clearances_rank: z.number().nullable().optional(),
  inside50s: z.number().nullable().optional(),
  inside50s_rank: z.number().nullable().optional(),
  rebound50s: z.number().nullable().optional(),
  rebound50s_rank: z.number().nullable().optional(),
  contestedPossessions: z.number().nullable().optional(),
  contestedPossessions_rank: z.number().nullable().optional(),
  status: z.string().optional(),
  byeRound: z.number().optional(),
  gamesMissedInjury: z.number().optional(),
  gamesMissedOmitted: z.number().optional(),
  customStats: z.record(z.number().nullable()).optional(),
});

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type Player = z.infer<typeof PlayerSchema>;
export type Team = z.infer<typeof TeamSchema>;