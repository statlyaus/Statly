import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Typed guard for aggregate count support on Firestore Query
type CountAggregate = { get: () => Promise<{ data: () => { count: number } }> };
function hasAggregateCount(
  q: FirebaseFirestore.Query
): q is FirebaseFirestore.Query & { count: () => CountAggregate } {
  return typeof (q as { count?: unknown }).count === 'function';
}

// Typed shape of per-league availablePlayers index documents
interface AvailableIndexDoc {
  ownershipPercent?: number;
  ownership?: number;
  position?: string;
  available?: boolean;
  team?: string;
}

async function getPrismaLeaguePlayers(input: {
  leagueId: string;
  owned: boolean;
  limit: number;
  cursor?: string;
  team?: string;
  position?: string;
}) {
  const ownerships = await prisma.leagueRosterPlayer.findMany({
    where: { leagueId: input.leagueId },
    select: { playerId: true, memberId: true },
  });
  const ownedPlayerIds = ownerships.map((ownership) => ownership.playerId);

  if (input.owned && ownedPlayerIds.length === 0) {
    return { items: [], nextCursor: null, total: 0 };
  }

  const ownershipIdFilter: { in?: string[]; notIn?: string[] } = {};
  if (input.owned) {
    ownershipIdFilter.in = ownedPlayerIds;
  } else if (ownedPlayerIds.length > 0) {
    ownershipIdFilter.notIn = ownedPlayerIds;
  }
  const playerFilters = {
    active: true,
    ...(input.team ? { club: input.team } : {}),
    ...(input.position ? { position: input.position } : {}),
  };
  const totalWhere = {
    ...playerFilters,
    ...(Object.keys(ownershipIdFilter).length > 0 ? { id: ownershipIdFilter } : {}),
  };

  const pageIdFilter: { in?: string[]; notIn?: string[]; gt?: string } = {
    ...ownershipIdFilter,
  };
  if (input.cursor) {
    pageIdFilter.gt = input.cursor;
  }
  const pageWhere = {
    ...playerFilters,
    ...(Object.keys(pageIdFilter).length > 0 ? { id: pageIdFilter } : {}),
  };

  const [players, total] = await Promise.all([
    prisma.player.findMany({
      where: pageWhere,
      orderBy: { id: 'asc' },
      take: input.limit,
      select: {
        id: true,
        name: true,
        club: true,
        position: true,
      },
    }),
    prisma.player.count({ where: totalWhere }),
  ]);

  const items = players.map((player) => ({
    id: player.id,
    name: player.name,
    team: player.club,
    position: player.position,
    ownership: input.owned ? 100 : 0,
  }));
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: players.length === input.limit && last ? last.id : null,
    total,
  };
}

// GET /api/leagues/[id]/players?limit=100&cursor=<lastId>&team=XXX&position=YYY&owned=true|false
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;

  // AuthN + AuthZ: require authenticated user and league membership
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Unified membership verification
  const membership = await verifyLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '100', 10);
    const limit = Math.max(10, Math.min(200, isNaN(limitParam) ? 100 : limitParam));
    const cursor = url.searchParams.get('cursor') || undefined;
    const team = url.searchParams.get('team') || undefined;
    const position = url.searchParams.get('position') || undefined;
    const ownedStr = url.searchParams.get('owned');
    const owned = ownedStr === 'true' ? true : ownedStr === 'false' ? false : undefined;

    if (typeof owned === 'boolean') {
      const prismaLeague = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true },
      });

      if (prismaLeague) {
        const result = await getPrismaLeaguePlayers({
          leagueId,
          owned,
          limit,
          cursor,
          team,
          position,
        });
        return NextResponse.json(result, { status: 200 });
      }
    }

    // Prefer per-league availability index when filtering by owned/unowned
    if (typeof owned === 'boolean') {
      try {
        let aq: FirebaseFirestore.Query = adminDb
          .collection('leagues')
          .doc(leagueId)
          .collection('availablePlayers')
          .where('available', '==', owned ? false : true);

        if (position) {
          aq = aq.where('position', '==', position);
        }

        aq = aq.orderBy('__name__');
        if (cursor) aq = aq.startAfter(cursor);
        aq = aq.limit(limit);

        const fetchPromise = aq.get();
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 3000)
        );
        const snap = (await Promise.race([
          fetchPromise,
          timeoutPromise,
        ])) as FirebaseFirestore.QuerySnapshot | null;

        if (snap) {
          // Build a quick lookup of ownership percentage from index docs if present
          const indexOwnership = new Map<string, number>();
          snap.docs.forEach((doc) => {
            const data = doc.data() as AvailableIndexDoc;
            const raw =
              typeof data?.ownershipPercent === 'number'
                ? data.ownershipPercent
                : typeof data?.ownership === 'number'
                  ? data.ownership
                  : undefined;
            if (typeof raw === 'number' && isFinite(raw)) {
              const pct = Math.max(0, Math.min(100, Math.round(raw)));
              indexOwnership.set(doc.id, pct);
            }
          });

          const ids = snap.docs.map((d) => d.id);
          let items: Array<{
            id: string;
            name: string;
            team?: string;
            position?: string;
            ownership?: number;
          }> = [];
          if (ids.length) {
            const refs = ids.map((id) => adminDb.collection('players').doc(id));
            const docs = await adminDb.getAll(...refs);
            // Monitor for race: availablePlayers listed IDs that no longer have player docs
            const missingPlayers = ids.filter((_, idx) => !docs[idx]?.exists);
            if (missingPlayers.length > 0) {
              console.warn('[players API] Missing player documents:', missingPlayers.join(', '));
            }
            items = docs
              .filter((d) => d.exists)
              .map((d) => {
                const data = d.data() as {
                  name?: string;
                  team?: string;
                  position?: string;
                  ownership?: number;
                };
                // Prefer percentage from index doc, then any numeric ownership on player, else fall back to 0/100 by owned flag
                const pctFromIndex = indexOwnership.get(d.id);
                const pctFromPlayer =
                  typeof data?.ownership === 'number' && isFinite(data.ownership)
                    ? Math.max(0, Math.min(100, Math.round(data.ownership)))
                    : undefined;
                return {
                  id: d.id,
                  name: data.name || `Player ${d.id}`,
                  team: data.team,
                  position: data.position,
                  ownership: pctFromIndex ?? pctFromPlayer ?? (owned ? 100 : 0),
                };
              });

            if (team) items = items.filter((p) => p.team === team);
          }

          const last = snap.docs[snap.docs.length - 1];
          const nextCursor = last ? last.id : null;

          let total: number | undefined = undefined;
          try {
            let countQ: FirebaseFirestore.Query = adminDb
              .collection('leagues')
              .doc(leagueId)
              .collection('availablePlayers')
              .where('available', '==', owned ? false : true);
            if (position) countQ = countQ.where('position', '==', position);
            if (hasAggregateCount(countQ)) {
              const aggregateSnapshot = await countQ.count().get();
              total = aggregateSnapshot.data().count as number;
            }
          } catch {
            // ignore
          }

          return NextResponse.json({ items, nextCursor, total }, { status: 200 });
        }
      } catch (e) {
        console.warn('[players API] availability-index path failed, falling back:', e);
      }
    }

    // Legacy path: query players and enrich ownership via playerOwnerships
    let q: FirebaseFirestore.Query = adminDb.collection('players');

    if (team) q = q.where('team', '==', team);
    if (position) q = q.where('position', '==', position);

    if (typeof owned === 'boolean') {
      q = q.where('ownershipStatus', '==', owned);
    }

    q = q.orderBy('__name__');
    if (cursor) q = q.startAfter(cursor);
    q = q.limit(limit);

    const fetchPromise = q.get();
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const snap = (await Promise.race([
      fetchPromise,
      timeoutPromise,
    ])) as FirebaseFirestore.QuerySnapshot | null;

    if (!snap) {
      return NextResponse.json({ items: [], nextCursor: null, total: undefined }, { status: 200 });
    }

    const items: Array<{
      id: string;
      name: string;
      team?: string;
      position?: string;
      ownership?: number;
    }> = [];

    snap.forEach((doc) => {
      const d = doc.data() as {
        name?: string;
        team?: string;
        position?: string;
        ownership?: number;
      };
      const basePct =
        typeof d?.ownership === 'number' && isFinite(d.ownership)
          ? Math.max(0, Math.min(100, Math.round(d.ownership)))
          : undefined;
      items.push({
        id: doc.id,
        name: d.name || `Player ${doc.id}`,
        team: d.team,
        position: d.position,
        ownership: basePct,
      });
    });

    try {
      const ownershipRefs = items.map((p) =>
        adminDb.collection('leagues').doc(leagueId).collection('playerOwnerships').doc(p.id)
      );
      if (ownershipRefs.length) {
        const ownershipSnaps = await adminDb.getAll(...ownershipRefs);
        ownershipSnaps.forEach((os, idx) => {
          const data = os.exists
            ? (os.data() as {
                owners?: string[];
                available?: boolean;
                ownershipPercent?: number;
                percent?: number;
              })
            : undefined;
          // If there is a numeric ownership percentage on the ownership doc, prefer it
          const pctFromDoc =
            typeof data?.ownershipPercent === 'number'
              ? data.ownershipPercent
              : typeof data?.percent === 'number'
                ? data.percent
                : undefined;
          if (typeof pctFromDoc === 'number' && isFinite(pctFromDoc)) {
            items[idx].ownership = Math.max(0, Math.min(100, Math.round(pctFromDoc)));
          } else {
            const isOwned = Array.isArray(data?.owners) && data!.owners!.length > 0;
            if (typeof items[idx].ownership !== 'number') {
              items[idx].ownership = isOwned ? 100 : 0;
            }
          }
        });
      }
    } catch (_e) {
      // Ignore ownership enhancement failures
    }

    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last ? last.id : null;

    let total: number | undefined = undefined;
    try {
      let countQ: FirebaseFirestore.Query = adminDb.collection('players');
      if (team) countQ = countQ.where('team', '==', team);
      if (position) countQ = countQ.where('position', '==', position);
      if (typeof owned === 'boolean') countQ = countQ.where('ownershipStatus', '==', owned);
      if (hasAggregateCount(countQ)) {
        const aggregateSnapshot = await countQ.count().get();
        total = aggregateSnapshot.data().count as number;
      }
    } catch {
      // Best-effort only
    }

    return NextResponse.json({ items, nextCursor, total }, { status: 200 });
  } catch (error) {
    console.error('[players API] error', error);
    return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}
