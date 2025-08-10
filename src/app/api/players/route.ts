export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPlayers } from '@/lib/data';

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
        num > 100
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit must be an integer between 1 and 100",
        });
        return z.NEVER;
      }
      return num;
    })
    .default("20"),
});

export async function GET(request: NextRequest) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          message: 'Invalid query parameters',
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const { search, team, position, page, limit } = parsed.data;

    const players = await getPlayers({ search, team, position });
    const total = players.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pagedPlayers = players.slice(start, end);

    return NextResponse.json({
      players: pagedPlayers,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('API Error fetching players:', error);
    return NextResponse.json(
      { message: 'Failed to fetch players' },
      { status: 500 }
    );
  }
}
