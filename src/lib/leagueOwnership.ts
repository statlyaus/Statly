import 'server-only';

import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';

export async function getLeagueOwnershipMap(
  leagueId: string,
  playerIds?: Iterable<string>
): Promise<{ totalTeams: number; counts: Map<string, number> }> {
  const filterSet = playerIds ? new Set(Array.from(playerIds).map(String)) : null;
  const counts = new Map<string, number>();
  let totalTeams = 0;

  try {
    totalTeams = await prisma.leagueMember.count({ where: { leagueId } });
    if (totalTeams > 0) {
      if (filterSet && filterSet.size > 0) {
        const ids = Array.from(filterSet);
        const rows = await prisma.leagueRosterPlayer.findMany({
          where: { leagueId, playerId: { in: ids } },
          select: { playerId: true, memberId: true },
        });
        const seen = new Map<string, Set<string>>();
        rows.forEach((row) => {
          const id = String(row.playerId);
          if (!seen.has(id)) seen.set(id, new Set());
          seen.get(id)!.add(String(row.memberId));
        });
        seen.forEach((members, id) => {
          counts.set(id, members.size);
        });
        return { totalTeams, counts };
      }

      const rows = (await prisma.$queryRaw`
        SELECT "playerId", COUNT(DISTINCT "memberId")::int AS "count"
        FROM "LeagueRosterPlayer"
        WHERE "leagueId" = ${leagueId}
        GROUP BY "playerId"
      `) as Array<{ playerId: string; count: number }>;

      rows.forEach((row) => {
        const id = String(row.playerId);
        if (filterSet && !filterSet.has(id)) return;
        counts.set(id, Number(row.count) || 0);
      });

      return { totalTeams, counts };
    }
  } catch {
    // Fall through to Firestore scan
  }

  const snap = await adminDb.collection('leagues').doc(leagueId).collection('rosters').get();
  totalTeams = snap.size;

  snap.forEach((doc) => {
    const data = doc.data() as { playerIds?: Array<string | number> };
    const ids = Array.isArray(data.playerIds) ? data.playerIds : [];
    const uniqueIds = new Set(ids.map((id) => String(id)));
    uniqueIds.forEach((id) => {
      if (filterSet && !filterSet.has(id)) return;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
  });

  return { totalTeams, counts };
}

export async function getLeagueOwnershipDetails(
  leagueId: string,
  playerIds?: Iterable<string>
): Promise<{
  totalTeams: number;
  counts: Map<string, number>;
  owners: Map<string, string[]>;
}> {
  const filterSet = playerIds ? new Set(Array.from(playerIds).map(String)) : null;
  const counts = new Map<string, number>();
  const owners = new Map<string, string[]>();
  let totalTeams = 0;

  try {
    totalTeams = await prisma.leagueMember.count({ where: { leagueId } });
    if (totalTeams > 0) {
      const rows = await prisma.leagueRosterPlayer.findMany({
        where: {
          leagueId,
          ...(filterSet ? { playerId: { in: Array.from(filterSet) } } : {}),
        },
        select: {
          playerId: true,
          member: { select: { teamName: true } },
        },
      });

      rows.forEach((row) => {
        const id = String(row.playerId);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        const teamName = row.member?.teamName;
        if (teamName) {
          const list = owners.get(id) ?? [];
          if (!list.includes(teamName)) list.push(teamName);
          owners.set(id, list);
        }
      });

      return { totalTeams, counts, owners };
    }
  } catch {
    // Fall through to Firestore scan
  }

  const membersSnap = await adminDb
    .collection('leagues')
    .doc(leagueId)
    .collection('members')
    .where('isActive', '==', true)
    .get();
  const memberMap = new Map(
    membersSnap.docs.map((doc) => [doc.id, doc.data()?.teamName as string | undefined])
  );

  const snap = await adminDb.collection('leagues').doc(leagueId).collection('rosters').get();
  totalTeams = snap.size;

  snap.forEach((doc) => {
    const data = doc.data() as {
      playerIds?: Array<string | number>;
      teamName?: string;
    };
    const ids = Array.isArray(data.playerIds) ? data.playerIds : [];
    const uniqueIds = new Set(ids.map((id) => String(id)));
    const teamName =
      typeof data.teamName === 'string' ? data.teamName : memberMap.get(doc.id) ?? undefined;
    uniqueIds.forEach((id) => {
      if (filterSet && !filterSet.has(id)) return;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (teamName) {
        const list = owners.get(id) ?? [];
        if (!list.includes(teamName)) list.push(teamName);
        owners.set(id, list);
      }
    });
  });

  return { totalTeams, counts, owners };
}
