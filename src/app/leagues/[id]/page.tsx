const rawRevalidate = process.env.LEAGUE_REVALIDATE_SECONDS;
const parsedRevalidate = rawRevalidate !== undefined ? Number(rawRevalidate) : NaN;
export const revalidate = Number.isFinite(parsedRevalidate) && parsedRevalidate >= 0 ? Math.floor(parsedRevalidate) : 3600;

import type { League, LeagueMember } from '@/types/leagues';
import LeaguePageClient from './LeaguePageClient';
import { tags } from '@/lib/cacheTags';
import { z } from 'zod';

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`/api/leagues/${id}`, {
    next: { tags: [tags.league(id), tags.draft(id), tags.trades(id), tags.waivers(id)] },
  });
  if (!res.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {}
    const bodyLength = typeof bodyText === 'string' ? bodyText.length : 0;
    const preview = typeof bodyText === 'string' ? (bodyText.length > 200 ? bodyText.slice(0, 200) + '…' : bodyText) : undefined;
    console.error('Failed to fetch league', { id, status: res.status, bodyPreview: preview, bodyLength });
    return (
      <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Failed to load league (${id}) status=${res.status}`}/>
    );
  }
  let json: any;
  try {
    json = await res.json();
  } catch (e) {
    console.error('Failed to parse league response JSON', { id, error: e instanceof Error ? e.message : String(e) });
    return <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Malformed league response for ${id}`}/>;
  }
  const MemberSchema = z.object({ id: z.string().min(1) }).passthrough();
  const LeagueSchema = z.object({ id: z.string().min(1) }).passthrough();
  const ApiShape = z.object({
    success: z.literal(true),
    data: z.object({
      league: LeagueSchema.nullable(),
      members: z.array(MemberSchema).default([]),
    }),
  });

  const parsed = ApiShape.safeParse(json);
  if (!parsed.success) {
    console.error('League API parse error', { id, issues: parsed.error.issues });
    return <LeaguePageClient league={null} members={[]} leagueId={id} errorMsg={`Invalid league payload for ${id}`}/>;
  }
  const league = (parsed.data.data.league as League | null) ?? null;
  const members = (parsed.data.data.members as LeagueMember[]) ?? [];
  return <LeaguePageClient league={league} members={members} leagueId={id} />;
}