export const runtime = 'nodejs';

// Updated to support higher limits for player linking functionality
import { z } from 'zod';
import { getPlayers } from '@/lib/data';
import { middlewareConfigs, createResponse } from '@/lib/apiMiddleware';
import { ApplicationError } from '@/lib/errorHandling';

const querySchema = z.object({
  search: z.string().optional(),
  team: z.string().optional(),
  position: z.string().optional(),
  page: z
    .string()
    .transform((val, ctx) => {
      const num = Number(val);
      if (!val || val.trim() === "") return 1; // default
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Page must be a positive integer",
        });
        return z.NEVER;
      }
      return num;
    })
    .default("1"),
  limit: z
    .string()
    .transform((val, ctx) => {
      const num = Number(val);
      if (!val || val.trim() === "") return 20; // default
      if (
        !Number.isFinite(num) ||
        !Number.isInteger(num) ||
        num < 1 ||
        num > 5000
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit must be an integer between 1 and 5000",
        });
        return z.NEVER;
      }
      return num;
    })
    .default("20"),
});

export const GET = middlewareConfigs.public(async ({ req }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  
  if (!parsed.success) {
    throw new ApplicationError(
      'Invalid query parameters',
      'VALIDATION_ERROR',
      400,
      { errors: parsed.error.flatten().fieldErrors }
    );
  }
  
  const { search, team, position, page, limit } = parsed.data;

  const players = await getPlayers({ search, team, position });
  const total = players.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const pagedPlayers = players.slice(start, end);

  return createResponse({
    players: pagedPlayers,
    total,
    page,
    limit,
  });
});
