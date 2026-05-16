export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { z } from 'zod';

import { middlewareConfigs } from '@/lib/apiMiddleware';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { listPlayerPool } from '@/server/players/playerPool';

const querySchema = z.object({
  search: z.string().optional(),
  team: z.string().optional(),
  position: z.string().optional(),
  season: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') {
        return undefined;
      }
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 2020 || num > 2030) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Season must be a year between 2020 and 2030',
        });
        return z.NEVER;
      }
      return num;
    }),
  page: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 1; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Page must be a positive integer',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(1),
  limit: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 20; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Limit must be an integer between 1 and 1000',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(20),
});

export const GET = middlewareConfigs.public(async ({ req }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { search, team, position, season: requestedSeason, page, limit } = parsed.data;
  const leagueId = req.nextUrl.searchParams.get('leagueId') || undefined;

  if (leagueId) {
    const uid = await getAuthenticatedUserId(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const membership = await verifyLeagueMembership(leagueId, uid);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const result = await listPlayerPool({
    search,
    team,
    position,
    requestedSeason,
    page,
    limit,
    leagueId,
    fallbackSeason: getDefaultAflSeason(),
  });

  return NextResponse.json(
    {
      players: result.players,
      season: result.season,
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
    {
      headers: leagueId
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    }
  );
});
