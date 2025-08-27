import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

// GET /api/leagues/[leagueId]/players?limit=100&cursor=<lastId>&team=XXX&position=YYY&owned=true|false
export async function GET(req: Request, context: { params: { leagueId: string } }) {
  const { leagueId } = context.params;
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '100', 10);
    const limit = Math.max(10, Math.min(200, isNaN(limitParam) ? 100 : limitParam));
    const cursor = url.searchParams.get('cursor') || undefined;
    const team = url.searchParams.get('team') || undefined;
    const position = url.searchParams.get('position') || undefined;
    const ownedStr = url.searchParams.get('owned');
    const owned = ownedStr === 'true' ? true : ownedStr === 'false' ? false : undefined;

    // Prefer per-league availability index when filtering by owned/unowned
    if (typeof owned === 'boolean') {
      try {
        let aq: FirebaseFirestore.Query = adminDb
          .collection('leagues').doc(leagueId)
          .collection('availablePlayers')
          .where('available', '==', owned ? false : true);

        // Apply position filter if present in index
        if (position) {
          aq = aq.where('position', '==', position);
        }
        // Optional: team may not exist on index; we'll post-filter after fetching base player docs

        aq = aq.orderBy('__name__');
        if (cursor) aq = aq.startAfter(cursor);
        aq = aq.limit(limit);

        const fetchPromise = aq.get();
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
        const snap = (await Promise.race([fetchPromise, timeoutPromise])) as FirebaseFirestore.QuerySnapshot | null;

        if (snap) {
          const ids = snap.docs.map((d) => d.id);
          let items: Array<{ id: string; name: string; team?: string; position?: string; ownership?: number }> = [];
          if (ids.length) {
            const refs = ids.map((id) => adminDb.collection('players').doc(id));
            const docs = await adminDb.getAll(...refs);
            items = docs
              .filter((d) => d.exists)
              .map((d) => {
                const data = d.data() as { name?: string; team?: string; position?: string };
                return {
                  id: d.id,
                  name: data.name || `Player ${d.id}`,
                  team: data.team,
                  position: data.position,
                  ownership: owned ? 100 : 0,
                };
              });

            // Apply team filter if requested but not enforced in index
            if (team) items = items.filter((p) => p.team === team);
          }

          const last = snap.docs[snap.docs.length - 1];
          const nextCursor = last ? last.id : null;

          // Best-effort total via index count if available
          let total: number | undefined = undefined;
          try {
            let countQ: FirebaseFirestore.Query = adminDb
              .collection('leagues').doc(leagueId)
              .collection('availablePlayers')
              .where('available', '==', owned ? false : true);
            if (position) countQ = countQ.where('position', '==', position);
            const maybeCount = (countQ as unknown as { count?: () => { get: () => Promise<{ data: () => { count: number } }> } }).count;
            if (typeof maybeCount === 'function') {
              const agg = await maybeCount.call(countQ).get();
              total = agg.data().count as number;
            }
          } catch {
            // ignore
          }

          return NextResponse.json({ items, nextCursor, total }, { status: 200 });
        }
      } catch (e) {
        // Fall through to legacy path on error
        console.warn('[players API] availability-index path failed, falling back:', e);
      }
    }

    // Legacy path: query players and enrich ownership via playerOwnerships
    let q: FirebaseFirestore.Query = adminDb.collection('players');

    if (team) q = q.where('team', '==', team);
    if (position) q = q.where('position', '==', position);

    // Optional global denormalized flag if present
    if (typeof owned === 'boolean') {
      q = q.where('ownershipStatus', '==', owned);
    }

    q = q.orderBy('__name__');
    if (cursor) q = q.startAfter(cursor);
    q = q.limit(limit);

    // Fetch with timeout safety
    const fetchPromise = q.get();
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const snap = (await Promise.race([fetchPromise, timeoutPromise])) as FirebaseFirestore.QuerySnapshot | null;

    if (!snap) {
      return NextResponse.json({ items: [], nextCursor: null, total: undefined }, { status: 200 });
    }

    const items: Array<{ id: string; name: string; team?: string; position?: string; ownership?: number }> = [];

    snap.forEach((doc) => {
      const d = doc.data() as { name?: string; team?: string; position?: string };
      items.push({ id: doc.id, name: d.name || `Player ${doc.id}`, team: d.team, position: d.position });
    });

    // Compute ownership for the current league in batch via playerOwnerships collection
    try {
      const ownershipRefs = items.map((p) =>
        adminDb.collection('leagues').doc(leagueId).collection('playerOwnerships').doc(p.id)
      );
      if (ownershipRefs.length) {
        const ownershipSnaps = await adminDb.getAll(...ownershipRefs);
        ownershipSnaps.forEach((os, idx) => {
          const data = os.exists ? (os.data() as { owners?: string[]; available?: boolean }) : undefined;
          const isOwned = Array.isArray(data?.owners) && data!.owners!.length > 0;
          items[idx].ownership = isOwned ? 100 : 0;
        });
      }
    } catch (_e) {
      // Ignore ownership enhancement failures
      // Items will be returned without ownership markers
    }

    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last ? last.id : null;

    // Try to include total count for client UX (optional; ignore on error)
    let total: number | undefined = undefined;
    try {
      let countQ: FirebaseFirestore.Query = adminDb.collection('players');
      if (team) countQ = countQ.where('team', '==', team);
      if (position) countQ = countQ.where('position', '==', position);
      if (typeof owned === 'boolean') countQ = countQ.where('ownershipStatus', '==', owned);
      const maybeCount = (countQ as unknown as { count?: () => { get: () => Promise<{ data: () => { count: number } }> } }).count;
      if (typeof maybeCount === 'function') {
        const agg = await maybeCount.call(countQ).get();
        total = agg.data().count as number;
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
