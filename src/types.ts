// src/types.ts

import { z } from 'zod'; // ✅ Ensure zod is imported

export const MatchLogSchema = z.object({
  date: z.string(), // e.g. "2025-07-24"
  round: z.string(), // e.g. "Round 20"
  venue: z.string(),
  opposition: z.string(),
  status: z.string(), // "Home" or "Away"

  kicks: z.number(),
  handballs: z.number(),
  disposals: z.number(),
  marks: z.number(),
  tackles: z.number(),
  goals: z.number(),
  behinds: z.number(),
  hitouts: z.number(),
  clearances: z.number(),
  clangers: z.number(),
  contested_possessions: z.number(),
  uncontested_possessions: z.number(),
  intercepts: z.number(),
});

export type MatchLog = z.infer<typeof MatchLogSchema>;

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  team: z.string(),
  avg: z.number().optional(),
  goals: z.number().optional(),
  kicks: z.number().optional(),
  isWatched: z.boolean().optional(),
  games: z.number().optional(),
  injury: z.string().optional(),
  stats: z.record(z.string(), z.number()).optional(),
  summary: z.record(z.string(), z.number()).optional(),
  matchLogs: z.array(MatchLogSchema).optional(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  players: z.array(z.string()), // array of player IDs
});

export type Team = z.infer<typeof TeamSchema>;
