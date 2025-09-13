import 'server-only';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { assertLeagueMember } from '@/lib/leagueMembership';
import type { LivePlayerRow, RosterListResponse, RosterResponse } from '@/types/live';
import { FieldPath } from 'firebase-admin/firestore';

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
  const uid = await getAuthenticatedUserId();
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
  const nextCursor = snap.docs.length > limit ? docs[docs.length - 1]?.id ?? null : null;

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
  teamFilter?: string;      // optional in-memory filter on player.team
  positionFilter?: string;  // optional in-memory filter on player.position
}): Promise<RosterResponse> {
  const uid = await getAuthenticatedUserId();
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
    return {
      id: d.id,
      name: p?.name ?? d.id,
      team: p?.team,
      position: p?.position,
      injury: p?.injury ?? p?.status,
    };
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
