import 'server-only';
// Server Component: paginated, authenticated roster page using Admin SDK (bi-directional via URL cursor stack)
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { FieldPath } from 'firebase-admin/firestore';

import { AppLayout } from '@/components/navigation';
import { adminDb } from '@/lib/firebaseAdmin';
import { getTeamLogo } from '@/lib/teamLogos';
import type { Player } from '@/types/players';

// Light roster player type
export type RosterPlayer = Pick<Player, 'id' | 'name' | 'team' | 'position' | 'injury'>;

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/** Normalize a search param into a string (take the first if array, else empty string). */
function getFirstParam(p: string | string[] | undefined): string {
  return Array.isArray(p) ? (p[0] ?? '') : (p ?? '');
}

/**
 * Parse a comma-separated stack param into a clean array of ids.
 */
function parseStack(stackParam: string | string[] | undefined): string[] {
  const raw = getFirstParam(stackParam);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function PlayerCard({ player }: { player: RosterPlayer }) {
  return (
    <div className="p-4 border rounded shadow-sm bg-white">
      <h2 className="font-semibold text-lg">
        {player.name}
        {player.injury && <span className="ml-2 text-sm text-red-600">{player.injury}</span>}
      </h2>
      <p className="flex items-center gap-2 text-sm text-gray-600">
        {player.team ? (
          <img
            src={getTeamLogo(player.team)}
            alt=""
            width={18}
            height={18}
            className="h-[18px] w-[18px] shrink-0 object-contain"
          />
        ) : null}
        <span>
          {player.team} - {player.position}
        </span>
      </p>
    </div>
  );
}

// Accept URL search params for filters and cursor-stack pagination
export default async function RostersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const params = (await searchParams) ?? {};

  // ---- Require authentication (Admin SDK bypasses rules) ----
  const cookieStore = await cookies();
  const session = cookieStore.get('statly_session')?.value;
  if (!session) {
    redirect('/login');
  }

  // ---- Filters & pagination inputs from URL ----
  const teamFilter = getFirstParam(params?.team).trim();
  const positionFilter = getFirstParam(params?.position).trim();
  const limitRaw = getFirstParam(params?.limit);
  const limitParsed = parseInt(limitRaw || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(
    Math.max(Number.isFinite(limitParsed) ? limitParsed : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  // The stack is a comma-separated list of document IDs representing the "startAfter" chain.
  // Example flow:
  //  - Page 1: stack=[]
  //  - Next -> Page 2: stack=[lastIdOfPage1]
  //  - Next -> Page 3: stack=[lastIdOfPage1,lastIdOfPage2]
  //  - Prev from Page 3 -> Page 2: stack becomes [lastIdOfPage1]
  const stack = parseStack(params?.stack);
  const startAfterId = stack.length ? stack[stack.length - 1] : null;

  // ---- Build server-side query (scales; no full collection scan) ----
  let q = adminDb
    .collection('players')
    .orderBy(FieldPath.documentId())
    .limit(limit + 1); // +1 to detect "hasNext"

  // Server-side filtering (ensure indexes exist for combined filters if needed)
  if (teamFilter) q = q.where('team', '==', teamFilter);
  if (positionFilter) q = q.where('position', '==', positionFilter);

  // Resume after the last id in the stack
  if (startAfterId) {
    const cursorSnap = await adminDb.collection('players').doc(startAfterId).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.id);
    }
  }

  const snap = await q.get();
  // First `limit` docs are the page; the (limit+1)th indicates "has next"
  const pageDocs = snap.docs.slice(0, limit);
  const hasNext = snap.docs.length > limit;

  // The cursor for "next page" is the last doc *we actually display* on this page.
  const currentPageLastId = pageDocs.length ? pageDocs[pageDocs.length - 1]!.id : null;

  const players: RosterPlayer[] = pageDocs.map((doc) => {
    const d = doc.data() as any;
    return {
      id: doc.id,
      name: d.name,
      team: d.team,
      position: d.position,
      injury: d.injury ?? d.status,
    };
  });

  // Helper to build links while preserving filters, limit, and stack
  function linkWith(params: {
    stack?: string[];
    replaceStack?: boolean;
    toNext?: boolean;
    toPrev?: boolean;
  }) {
    const u = new URLSearchParams();
    if (teamFilter) u.set('team', teamFilter);
    if (positionFilter) u.set('position', positionFilter);
    if (limit !== DEFAULT_LIMIT) u.set('limit', String(limit));

    // Decide final stack to encode
    let finalStack: string[] = Array.isArray(params.stack) ? params.stack : stack;

    // Navigate forward: push this page's last id
    if (params.toNext && currentPageLastId) {
      finalStack = [...stack, currentPageLastId];
    }

    // Navigate backward: pop one
    if (params.toPrev) {
      finalStack = stack.slice(0, -1);
    }

    if (finalStack.length) u.set('stack', finalStack.join(','));

    return `/rosters${u.toString() ? `?${u.toString()}` : ''}`;
  }

  const canPrev = stack.length > 0;
  const canNext = hasNext && !!currentPageLastId;

  return (
    <AppLayout>
      <main className="p-6">
        <h1 className="text-2xl font-bold mb-4">Rosters</h1>

        {/* Simple GET form so filtering works without client JS */}
        <form className="flex flex-wrap items-end gap-4 mb-6" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Team</span>
            <input
              type="text"
              name="team"
              placeholder="Filter by Team"
              className="p-2 border rounded"
              defaultValue={teamFilter}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Position</span>
            <input
              type="text"
              name="position"
              placeholder="Filter by Position"
              className="p-2 border rounded"
              defaultValue={positionFilter}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Page size</span>
            <input
              type="number"
              name="limit"
              min={6}
              max={MAX_LIMIT}
              className="p-2 w-28 border rounded"
              defaultValue={String(limit)}
              aria-label="Page size"
            />
          </label>

          {/* Preserve stack when applying filters so people can tweak within the same page */}
          {stack.length > 0 && <input type="hidden" name="stack" value={stack.join(',')} />}

          <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white">
            Apply
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.length > 0 ? (
            players.map((player) => <PlayerCard key={player.id} player={player} />)
          ) : (
            <p className="col-span-full text-center text-gray-500">No players found.</p>
          )}
        </div>

        {/* Cursor pagination with Prev/Next */}
        <div className="flex items-center justify-center gap-3 mt-8">
          {canPrev ? (
            <a
              href={linkWith({ toPrev: true })}
              className="px-4 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              ← Previous
            </a>
          ) : (
            <span className="px-4 py-2 rounded bg-gray-200 text-gray-500">← Previous</span>
          )}

          {canNext ? (
            <a
              href={linkWith({ toNext: true })}
              className="px-4 py-2 rounded bg-blue-600 text-white"
            >
              Next →
            </a>
          ) : (
            <span className="px-4 py-2 rounded bg-gray-200 text-gray-500">Next →</span>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
