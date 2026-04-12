/**
 * Deprecated legacy roster reader.
 *
 * This module still reads Firebase league roster documents and should remain
 * quarantined until the entire roster surface is removed or rebuilt on the
 * consolidated Prisma roster domain. It is currently unreferenced by active
 * product code.
 */
import 'server-only';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';

import { FieldPath } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebaseAdmin';
import { assertLeagueMember } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import type { LivePlayerRow, RosterListResponse, RosterResponse } from '@/types/live';

/**
 * Lists roster "teams" for a league with docId cursor pagination.
 * Assumes documents under: leagues/{leagueId}/rosters/{teamId}
 * Each roster doc shape (minimum):
 * { teamName?: string, playerIds?: string[], updatedAt?: Timestamp }
 */
export async function listRosters(opts: {
  leagueId: string;
  limit?: number;
  cursor?: string | null;
}): Promise<RosterListResponse> {
  const hdrs = await headers();
  const req = new NextRequest('http://internal.local', { headers: hdrs });
  const uid = await getAuthenticatedUserId(req);
  if (!uid) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  await assertLeagueMember(opts.leagueId, uid);

  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);

  let q = adminDb
    .collection('leagues')
    .doc(opts.leagueId)
    .collection('rosters')
    .orderBy(FieldPath.documentId())
    .limit(limit + 1);

  if (opts.cursor) {
    const cursorSnap = await adminDb
      .collection('leagues')
      .doc(opts.leagueId)
      .collection('rosters')
      .doc(opts.cursor)
      .get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap.id);
  }

  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  const nextCursor = snap.docs.length > limit ? (docs[docs.length - 1]?.id ?? null) : null;

  const items = docs.map((d) => {
    const data = d.data() as { teamName?: string; playerIds?: string[] };
    return {
      teamId: d.id,
      teamName: data?.teamName,
      playerCount: Array.isArray(data?.playerIds) ? data.playerIds.length : 0,
    };
  });

  return { items, nextCursor };
}

/**
 * Returns a single roster's hydrated players as LivePlayerRow[].
 * Reads leagues/{leagueId}/rosters/{teamId}.playerIds then batch-fetches players/{id}.
 */
export async function getRoster(opts: {
  leagueId: string;
  teamId: string;
  teamFilter?: string; // optional in-memory filter on player.team
  positionFilter?: string; // optional in-memory filter on player.position
}): Promise<RosterResponse> {
  const hdrs = await headers();
  const req = new NextRequest('http://internal.local', { headers: hdrs });
  const uid = await getAuthenticatedUserId(req);
  if (!uid) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  await assertLeagueMember(opts.leagueId, uid);

  const docRef = adminDb
    .collection('leagues')
    .doc(opts.leagueId)
    .collection('rosters')
    .doc(opts.teamId);

  const rosterSnap = await docRef.get();
  if (!rosterSnap.exists) throw Object.assign(new Error('Not Found'), { status: 404 });

  const roster = rosterSnap.data() as {
    teamName?: string;
    playerIds?: string[];
    updatedAt?: FirebaseFirestore.Timestamp;
  };

  const ids = Array.isArray(roster.playerIds) ? roster.playerIds : [];
  if (ids.length === 0) {
    return {
      teamId: opts.teamId,
      teamName: roster.teamName,
      players: [],
      updatedAt: roster.updatedAt ? roster.updatedAt.toDate().toISOString() : null,
    };
  }

  // Batch hydrate players
  const refs = ids.map((id) => adminDb.collection('players').doc(id));
  const docs = await adminDb.getAll(...refs);

  let players: LivePlayerRow[] = docs.map((d) => {
    const p = d.data() as any;
    const season = new Date().getFullYear();
    const lastUpdated = p?.lastUpdated || null;

    return {
      // identity
      id: d.id,
      name: p?.name ?? d.id,
      team: p?.team ?? 'Unknown',
      position: p?.position ?? 'MID',

      // normalized counting stats (default to 0 if unknown)
      kicks: Number(p?.kicks) || 0,
      handballs: Number(p?.handballs) || 0,
      disposals: Number(p?.disposals) || (Number(p?.kicks) || 0) + (Number(p?.handballs) || 0) || 0,
      marks: Number(p?.marks) || 0,
      tackles: Number(p?.tackles) || 0,
      goals: Number(p?.goals) || 0,
      behinds: Number(p?.behinds) || 0,
      hitouts: Number(p?.hitouts) || 0,
      clearances: Number(p?.clearances) || 0,
      inside50s: Number(p?.inside50s) || 0,
      rebound50s: Number(p?.rebound50s) || 0,
      clangers: Number(p?.clangers) || 0,
      contested_possessions: Number(p?.contested_possessions) || 0,
      uncontested_possessions: Number(p?.uncontested_possessions) || 0,
      frees_for: Number(p?.frees_for) || 0,
      frees_against: Number(p?.frees_against) || 0,

      // optional advanced stats
      one_percenters: p?.one_percenters != null ? Number(p.one_percenters) : undefined,
      goal_assists: p?.goal_assists != null ? Number(p.goal_assists) : undefined,
      turnovers: p?.turnovers != null ? Number(p.turnovers) : undefined,
      intercepts: p?.intercepts != null ? Number(p.intercepts) : undefined,
      metres_gained: p?.metres_gained != null ? Number(p.metres_gained) : undefined,
      contested_marks: p?.contested_marks != null ? Number(p.contested_marks) : undefined,
      effective_disposals:
        p?.effective_disposals != null ? Number(p.effective_disposals) : undefined,
      score_involvements: p?.score_involvements != null ? Number(p.score_involvements) : undefined,
      minutes: p?.minutes != null ? Number(p.minutes) : undefined,
      tog_pct: p?.tog_pct != null ? Number(p.tog_pct) : undefined,

      // derived/meta
      fantasyScore: Number(p?.fantasyScore) || 0,
      round: Number(p?.round) || 0,
      season: Number(p?.season) || season,
      lastUpdated:
        typeof lastUpdated === 'string'
          ? lastUpdated
          : (lastUpdated?.toDate?.().toISOString?.() ?? new Date().toISOString()),
      source: p?.source ?? 'roster_hydrate',

      // extra UI field retained by LivePlayerRow
      injury: p?.injury ?? p?.status,
    } as LivePlayerRow;
  });

  // Optional in-memory filters
  if (opts.teamFilter) {
    const t = opts.teamFilter.toLowerCase();
    players = players.filter((p) => (p.team ?? '').toLowerCase().includes(t));
  }
  if (opts.positionFilter) {
    const pos = opts.positionFilter.toLowerCase();
    players = players.filter((p) => (p.position ?? '').toLowerCase().includes(pos));
  }

  return {
    teamId: opts.teamId,
    teamName: roster.teamName,
    players,
    updatedAt: roster.updatedAt ? roster.updatedAt.toDate().toISOString() : null,
  };
}
