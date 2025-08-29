export const revalidate = 3600; // 1 hour default, can be overridden via environment variable

import type { League, LeagueMember } from '@/types/leagues';
import type React from 'react';
import LeaguePageClient from './LeaguePageClient';
import { tags } from '@/lib/cacheTags';
import { z } from 'zod';

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;

  const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!baseUrl) {
    throw new Error('APP_BASE_URL or NEXT_PUBLIC_APP_URL (or VERCEL_URL) must be set for server fetches');
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
    const preview = typeof bodyText === 'string' ? (bodyText.length > 200 ? bodyText.slice(0, 200) + '…' : bodyText) : undefined;
    console.error('Failed to fetch league', { id, status: res.status, bodyPreview: preview, bodyLength, textError });
    return (
      <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Failed to load league (${id}) status=${res.status}`}/>
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    console.error('Failed to parse league response JSON', { id, error: e instanceof Error ? e.message : String(e) });
    return <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Malformed league response for ${id}`}/>;
  }
  const MemberSchema: z.ZodType<LeagueMember> = z.object({
    id: z.string().min(1),
    leagueId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['owner','manager','member']),
    teamName: z.string().min(1),
    joinedAt: z.string().min(1),
    leftAt: z.string().optional(),
    isActive: z.boolean().optional(),
  }).strict();
  const TradeSettingsSchema = z.object({
    tradeLimit: z.number(),
    tradeReview: z.enum(['none','admin','veto']),
    tradeDeadline: z.string().optional(),
  }).strict();
  const WaiverWireSchema = z.object({
    waiverOrder: z.array(z.string()),
    waiverPeriodHours: z.number(),
    waiverResetPolicy: z.enum(['weekly','rolling']),
  }).strict();
  const CategoryEnum = z.enum([
    'goals','kicks','handballs','marks','tackles','hitouts','clearances','inside50s','rebound50s','clangers','contestedPossessions','uncontestedPossessions','freesFor','freesAgainst','onePercenters','goalAssists','timeOnGroundPct','disposalEffPct','turnovers','intercepts','metresGained','contestedMarks','effectiveDisposals','scoreInvolvements'
  ] as const);
  const LeagueSchema: z.ZodType<League> = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    code: z.string().min(1),
    type: z.enum(['public','private']),
    ownerId: z.string().min(1),
    maxTeams: z.number().int().positive(),
    categories: z.array(CategoryEnum),
    tradeSettings: TradeSettingsSchema,
    waiverWire: WaiverWireSchema,
    createdAt: z.string().min(1),
    status: z.enum(['preseason','active','completed']),
    description: z.string().optional(),
    draftDate: z.string().optional(),
    currentTeams: z.number().int().nonnegative().optional(),
  }).strict();
  const ApiShape: z.ZodType<{ success: true; data: { league: League | null; members: LeagueMember[] } }> = z.object({
    success: z.literal(true),
    data: z.object({
      league: LeagueSchema.nullable(),
      members: z.array(MemberSchema).default([]),
    }).strict(),
  }).strict();

  const parsed = ApiShape.safeParse(json);
  if (!parsed.success) {
    console.error('League API parse error', { id, issues: parsed.error.issues });
    return <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Invalid league payload for ${id}`}/>;
  }
  const league = parsed.data.data.league;
  const members = parsed.data.data.members;
  return <LeaguePageClient league={league} members={members} leagueId={id} />;
}