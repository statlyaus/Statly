export const revalidate = 3600; // 1 hour default, can be overridden via environment variable

import type React from 'react';

import { headers } from 'next/headers';

import { z } from 'zod';

import { tags } from '@/lib/cacheTags';
import type { League, LeagueMember } from '@/types/leagues';

import LeaguePageClient from './LeaguePageClient';




export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  let id: string;
  try {
    const resolvedParams = await params;
    id = resolvedParams?.id;
    
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      console.error('Invalid league ID in params', { 
        params: resolvedParams,
        idType: typeof id,
        idValue: id 
      });
      return (
        <LeaguePageClient
          league={null}
          members={[]}
          leagueId=""
          errorMsg="Invalid league ID: Missing or invalid league identifier"
        />
      );
    }
  } catch (error) {
    console.error('Failed to resolve params', { error });
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId=""
        errorMsg="Failed to parse league ID from URL"
      />
    );
  }

  // Resolve base URL from env or request headers to work in dev and prod
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? undefined;
  const proto =
    hdrs.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const envBase =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const baseUrl = envBase || (host ? `${proto}://${host}` : undefined) || 'http://localhost:3000';

  // Double-check id is still valid before making request
  if (!id || typeof id !== 'string') {
    console.error('League ID became invalid before API call', { id, idType: typeof id });
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId=""
        errorMsg="Invalid league ID"
      />
    );
  }

  const url = new URL(`/api/leagues/${id}`, baseUrl).toString();

  const res = await fetch(url, {
    next: { tags: [tags.league(id), tags.draft(id), tags.trades(id), tags.waivers(id)] },
  });
  if (!res.ok) {
    let bodyText: string | undefined;
    let textError: unknown;
    try {
      bodyText = await res.text();
    } catch (err) {
      textError = err;
    }
    const bodyLength = typeof bodyText === 'string' ? bodyText.length : 0;
    const preview =
      typeof bodyText === 'string'
        ? bodyText.length > 200
          ? bodyText.slice(0, 200) + '…'
          : bodyText
        : undefined;
    console.error('Failed to fetch league', {
      id,
      status: res.status,
      bodyPreview: preview,
      bodyLength,
      textError,
      url,
    });
    // Ensure id is defined when constructing error message
    const safeId = id && typeof id === 'string' ? id : 'unknown';
    const errorMessage = `Failed to load league (${safeId}) status=${res.status}`;
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId={safeId}
        errorMsg={errorMessage}
      />
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    console.error('Failed to parse league response JSON', {
      id,
      error: e instanceof Error ? e.message : String(e),
    });
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId={id}
        errorMsg={`Malformed league response for ${id}`}
      />
    );
  }
  const MemberSchema: z.ZodType<LeagueMember> = z
    .object({
      id: z.string().min(1),
      leagueId: z.string().min(1),
      userId: z.string().min(1),
      role: z.enum(['owner', 'manager', 'member']),
      teamName: z.string().min(1),
      joinedAt: z.string().min(1),
      leftAt: z.string().optional(),
      isActive: z.boolean().optional(),
      isBot: z.boolean().optional(),
    })
    .strict();
  const TradeSettingsSchema = z
    .object({
      tradeLimit: z.number(),
      tradeReview: z.enum(['none', 'admin', 'veto']),
      tradeDeadline: z.string().optional(),
    })
    .strict();
  const WaiverWireSchema = z
    .object({
      waiverOrder: z.array(z.string()),
      waiverPeriodHours: z.number(),
      waiverResetPolicy: z.enum(['weekly', 'rolling']),
      waiverSystem: z.enum(['ROLLING_LIST', 'FAAB']).optional(),
      waiverPriorityMode: z.enum(['ROLLING', 'REVERSE_LADDER']).optional(),
      waiverFaabBudget: z.number().optional(),
      waiverMinimumBid: z.number().optional(),
      waiverMaxWeekAcquisitions: z.number().optional(),
      waiverMaxSeasonAcquisitions: z.number().optional(),
      waiverMoveWinnerToBack: z.boolean().optional(),
      waiverAcquisitionLocked: z.boolean().optional(),
      cantDropList: z.array(z.string()).optional(),
    })
    .strict();
  const RosterSettingsSchema = z
    .object({
      rosterSize: z.number().int().positive(),
      benchSize: z.number().int().nonnegative(),
    })
    .strict();
  const DraftSettingsSchema = z
    .object({
      draftType: z.enum(['snake', 'linear']),
      timePerPick: z.number().int().positive(),
      allowAutoPick: z.boolean(),
      enableReminders: z.boolean(),
    })
    .strict();
  const CaptainSettingsSchema = z
    .object({
      enableCaptainSystem: z.boolean(),
      captainMultiplier: z.number().positive(),
      viceCaptainMultiplier: z.number().positive(),
    })
    .strict();
  const SeasonSettingsSchema = z
    .object({
      seasonWeeks: z.number().int().positive(),
      matchupsPerOpponent: z.union([z.literal(1), z.literal(2)]),
      playoffsEnabled: z.boolean(),
      playoffTeams: z.number().int().nonnegative(),
      playoffLegLengthWeeks: z.number().int().positive(),
      playoffReseedEachRound: z.boolean(),
      playoffIncludeConsolation: z.boolean(),
    })
    .strict();
  const CategoryEnum = z.enum([
    'goals',
    'kicks',
    'handballs',
    'marks',
    'tackles',
    'hitouts',
    'clearances',
    'inside50s',
    'rebound50s',
    'clangers',
    'contestedPossessions',
    'uncontestedPossessions',
    'freesFor',
    'freesAgainst',
    'onePercenters',
    'goalAssists',
    'timeOnGroundPct',
    'disposalEffPct',
    'turnovers',
    'intercepts',
    'metresGained',
    'contestedMarks',
    'effectiveDisposals',
    'scoreInvolvements',
  ] as const);
  const LeagueSchema: z.ZodType<League> = z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      code: z.string().min(1),
      type: z.enum(['public', 'private']),
      ownerId: z.string().min(1),
      maxTeams: z.number().int().positive(),
      categories: z.array(CategoryEnum),
      tradeSettings: TradeSettingsSchema,
      waiverWire: WaiverWireSchema,
      createdAt: z.string().min(1),
      status: z.enum(['preseason', 'active', 'completed']),
      description: z.string().optional(),
      draftDate: z.string().optional(),
      currentTeams: z.number().int().nonnegative().optional(),
      rosterSettings: RosterSettingsSchema.optional(),
      draftSettings: DraftSettingsSchema.optional(),
      captainSettings: CaptainSettingsSchema.optional(),
      seasonSettings: SeasonSettingsSchema.optional(),
    })
    .strict();
  const ApiShape: z.ZodType<{
    success: true;
    data: { league: League | null; members: LeagueMember[]; scoringCategories?: string[] };
  }> = z
    .object({
      success: z.literal(true),
      data: z
        .object({
          league: LeagueSchema.nullable(),
          members: z.array(MemberSchema).default([]),
          scoringCategories: z.array(CategoryEnum).optional(),
        })
        .passthrough(),
    })
    .passthrough();

  const parsed = ApiShape.safeParse(json);
  if (!parsed.success) {
    const shape =
      json && typeof json === 'object'
        ? Object.keys(json as Record<string, unknown>)
        : typeof json;
    console.error('League API parse error', {
      id,
      issues: parsed.error.issues,
      shape,
      jsonPreview:
        json && typeof json === 'object'
          ? JSON.stringify(json).slice(0, 500)
          : String(json).slice(0, 200),
    });
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId={id}
        errorMsg={`Invalid league payload for ${id}`}
      />
    );
  }
  const league = parsed.data.data.league;
  const members = parsed.data.data.members;
  return <LeaguePageClient league={league} members={members} leagueId={id} />;
}
