export const revalidate = 60;
import { AppLayout } from '@/components/navigation';
import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';
import { adminDb } from '@/lib/firebaseAdmin';
import { firestoreTimestampToDate } from '@/utils/firestore';
import type { FirebaseTimestamp } from '@/types/firebase';

// Configurable timeout for the initial players fetch (defaults to 5000ms)
const PLAYERS_FETCH_TIMEOUT_MS = (() => {
  const v = Number(process.env.PLAYERS_FETCH_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 5000;
})();

interface SSRClaim {
  id: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  createdAt: string; // ISO
  processedAt?: string; // ISO
}

interface SSRPlayerLite {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number; // percentage or 0/100 marker
}

interface SSRMemberLite {
  userId: string;
  teamId?: string;
  teamName?: string;
}

export default async function LeagueWaiversPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;

  // Preload data server-side
  const leagueRef = adminDb.collection('leagues').doc(leagueId);

  let settingsSnap, waiversSnap, rostersSnap, membersSnap;
  try {
    [settingsSnap, waiversSnap, rostersSnap, membersSnap] = await Promise.all([
      leagueRef.collection('config').doc('settings').get(),
      leagueRef.collection('waivers').orderBy('createdAt', 'desc').limit(50).get(),
      leagueRef.collection('rosters').get(),
      leagueRef.collection('members').get(),
    ]);
  } catch (error) {
    console.error('[LeagueWaiversPage] Failed to fetch base data for league:', leagueId, error);
    throw new Error(
      `Failed to load league data for league ${leagueId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Players: fetch a small initial page with timeout fallback; additional pages fetched client-side
  const INITIAL_PLAYER_PAGE = 100;
  let playersSnap: FirebaseFirestore.QuerySnapshot | null = null;
  try {
    const playersPromise = adminDb
      .collection('players')
      .orderBy('__name__')
      .limit(INITIAL_PLAYER_PAGE)
      .get();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PLAYERS_FETCH_TIMEOUT_MS)
    );
    const result = (await Promise.race([
      playersPromise,
      timeoutPromise,
    ])) as FirebaseFirestore.QuerySnapshot | null;
    playersSnap = result;
  } catch (err) {
    console.warn('[LeagueWaiversPage] Players fetch failed (will fallback to empty):', err);
    playersSnap = null;
  }

  type RosterDoc = { playerIds?: string[]; userId?: string; teamName?: string };
  const ownedIds = new Set<string>();
  const rosterTeamByUser = new Map<string, { teamId: string; teamName?: string }>();
  rostersSnap.forEach((doc) => {
    const data = doc.data() as RosterDoc;
    (data.playerIds || []).forEach((id) => ownedIds.add(String(id)));
    if (data.userId) {
      rosterTeamByUser.set(String(data.userId), { teamId: doc.id, teamName: data.teamName });
    }
  });

  // Members index: prefer members.teamName, fallback to roster teamName
  type MemberDoc = { userId?: string; teamName?: string };
  const membersIndex = Object.create(null) as Record<string, SSRMemberLite>;
  membersSnap.forEach((doc) => {
    const d = doc.data() as MemberDoc;
    const uid = d.userId ? String(d.userId) : doc.id;
    const rosterInfo = rosterTeamByUser.get(uid);
    membersIndex[uid] = {
      userId: uid,
      teamId: rosterInfo?.teamId,
      teamName: d.teamName || rosterInfo?.teamName,
    };
  });
  // Ensure any roster-only users are included
  rosterTeamByUser.forEach((info, uid) => {
    if (!membersIndex[uid]) {
      membersIndex[uid] = { userId: uid, teamId: info.teamId, teamName: info.teamName };
    }
  });

  // Build first page of players (if available)
  type PlayerDoc = { name?: string; team?: string; position?: string };
  const allPlayers: SSRPlayerLite[] = [];
  let initialPlayersCursor: string | null = null;
  if (playersSnap) {
    playersSnap.forEach((doc) => {
      const d = doc.data() as PlayerDoc;
      allPlayers.push({
        id: doc.id,
        name: d.name || `Player ${doc.id}`,
        team: d.team,
        position: d.position,
        ownership: ownedIds.has(doc.id) ? 100 : 0,
      });
    });
    const last = playersSnap.docs[playersSnap.docs.length - 1];
    initialPlayersCursor = last ? last.id : null;
  }

  // Only expose unowned players in the initial list (client can page more)
  const availablePlayers = allPlayers
    .filter((p) => (typeof p.ownership === 'number' ? p.ownership < 100 : true))
    .slice(0, 150);
  // Build index directly as a plain object for serialization to client
  const playersIndex = Object.fromEntries(allPlayers.map((p) => [p.id, p]));

  type WaiverDoc = {
    userId: string;
    teamId: string;
    playerId: string;
    dropPlayerId?: string;
    priority?: number;
    status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
    createdAt?: FirebaseTimestamp;
    processedAt?: FirebaseTimestamp;
  };
  const initialClaims: SSRClaim[] = [];
  waiversSnap.forEach((doc) => {
    const d = doc.data() as WaiverDoc;
    const created = firestoreTimestampToDate(d.createdAt) || new Date();
    const processed = firestoreTimestampToDate(d.processedAt);
    initialClaims.push({
      id: doc.id,
      userId: d.userId,
      teamId: d.teamId,
      playerId: d.playerId,
      dropPlayerId: d.dropPlayerId,
      priority: d.priority ?? 1,
      status: d.status || 'PENDING',
      createdAt: created.toISOString(),
      processedAt: processed ? processed.toISOString() : undefined,
    });
  });

  const waiverSettings = settingsSnap.exists ? (settingsSnap.data()?.waiverSettings ?? null) : null;

  return (
    <AppLayout>
      <LeagueWaiversContainer
        leagueId={leagueId}
        initialClaims={initialClaims}
        initialSettings={waiverSettings}
        availablePlayers={availablePlayers}
        playersIndex={playersIndex}
        membersIndex={membersIndex}
        initialPlayersCursor={initialPlayersCursor}
      />
    </AppLayout>
  );
}
