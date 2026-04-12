#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import { prisma } from '../src/lib/prisma';
import { getServiceAccountFromEnv } from '../src/lib/serviceAccount';
import { normalizeTeamName } from '../src/lib/teamLogos';

type TeamObservation = {
  count: number;
  latestUpdatedMs: number;
};

type PlayerClubCandidate = {
  playerIdHint: string | null;
  playerName: string | null;
  latestTeam: string;
  latestUpdatedMs: number;
  observationsByTeam: Map<string, TeamObservation>;
};

type ResolvedPlayerClubUpdate = {
  playerId: string;
  playerName: string;
  fromClub: string | null;
  toClub: string;
  sourcePlayerIdHint: string | null;
  sourceTeamCounts: Array<{ team: string; count: number }>;
};

function initializeAdminDb() {
  if (getApps().length === 0) {
    try {
      const serviceAccount = getServiceAccountFromEnv();
      initializeApp({
        credential: cert({
          projectId: serviceAccount.projectId,
          clientEmail: serviceAccount.clientEmail,
          privateKey: String(serviceAccount.privateKey).replace(/\\n/g, '\n'),
        }),
        projectId: serviceAccount.projectId,
      });
    } catch {
      initializeApp({
        credential: applicationDefault(),
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ??
          process.env.GCLOUD_PROJECT ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
  }

  return getFirestore();
}

const adminDb = initializeAdminDb();

function parseArgs(argv: string[]) {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];

  return {
    season: seasonArg ? Number(seasonArg) : getDefaultAflSeason(),
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    limit: limitArg ? Number(limitArg) : undefined,
  };
}

function normalizePlayerName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveTimestampMs(data: Record<string, unknown>): number {
  const candidate = data.updated_at ?? data.last_seen_at ?? data.created_at ?? null;

  if (!candidate) return 0;

  if (candidate instanceof Timestamp) {
    return candidate.toMillis();
  }

  if (candidate instanceof Date) {
    const timestampMs = candidate.getTime();
    return Number.isFinite(timestampMs) ? timestampMs : 0;
  }

  if (typeof candidate === 'object' && candidate !== null) {
    if (typeof (candidate as { toMillis?: unknown }).toMillis === 'function') {
      const timestampMs = (candidate as { toMillis: () => number }).toMillis();
      return Number.isFinite(timestampMs) ? timestampMs : 0;
    }

    if (typeof (candidate as { toDate?: unknown }).toDate === 'function') {
      const timestampMs = (candidate as { toDate: () => Date }).toDate().getTime();
      return Number.isFinite(timestampMs) ? timestampMs : 0;
    }
  }

  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getObservedTeam(data: Record<string, unknown>): string | null {
  const rawTeam =
    (typeof data.current_team === 'string' && data.current_team) ||
    (typeof data.team === 'string' && data.team) ||
    null;

  if (!rawTeam) return null;

  const normalized = normalizeTeamName(rawTeam.trim());
  return normalized || null;
}

function getOrCreateCandidate(
  candidates: Map<string, PlayerClubCandidate>,
  key: string,
  playerIdHint: string | null,
  playerName: string | null
): PlayerClubCandidate {
  const existing = candidates.get(key);
  if (existing) {
    if (!existing.playerIdHint && playerIdHint) existing.playerIdHint = playerIdHint;
    if (!existing.playerName && playerName) existing.playerName = playerName;
    return existing;
  }

  const created: PlayerClubCandidate = {
    playerIdHint,
    playerName,
    latestTeam: '',
    latestUpdatedMs: 0,
    observationsByTeam: new Map(),
  };
  candidates.set(key, created);
  return created;
}

async function collectCandidates(
  season: number,
  limit?: number
): Promise<Map<string, PlayerClubCandidate>> {
  const snapshot = await adminDb
    .collection('player_match_stats')
    .where('season', '==', season)
    .get();
  const candidates = new Map<string, PlayerClubCandidate>();
  let processed = 0;

  for (const doc of snapshot.docs) {
    if (typeof limit === 'number' && limit > 0 && processed >= limit) {
      break;
    }

    const data = doc.data() as Record<string, unknown>;
    const observedTeam = getObservedTeam(data);
    if (!observedTeam) continue;

    const playerIdHint =
      typeof data.player_id === 'string' && data.player_id.trim()
        ? data.player_id.trim()
        : typeof data.player_uid === 'string' && data.player_uid.trim()
          ? data.player_uid.trim()
          : null;
    const playerName =
      typeof data.player_name === 'string' && data.player_name.trim()
        ? data.player_name.trim()
        : null;
    const candidateKey = playerIdHint
      ? `id:${playerIdHint}`
      : `name:${normalizePlayerName(playerName)}`;
    if (!candidateKey || candidateKey === 'name:') continue;

    const candidate = getOrCreateCandidate(candidates, candidateKey, playerIdHint, playerName);
    const updatedMs = resolveTimestampMs(data);
    const existingObservation = candidate.observationsByTeam.get(observedTeam) ?? {
      count: 0,
      latestUpdatedMs: 0,
    };

    candidate.observationsByTeam.set(observedTeam, {
      count: existingObservation.count + 1,
      latestUpdatedMs: Math.max(existingObservation.latestUpdatedMs, updatedMs),
    });

    if (updatedMs > 0 && updatedMs >= candidate.latestUpdatedMs) {
      candidate.latestUpdatedMs = updatedMs;
      candidate.latestTeam = observedTeam;
    }

    processed += 1;
  }

  return candidates;
}

function chooseLatestTeam(candidate: PlayerClubCandidate): string | null {
  if (candidate.latestTeam) return candidate.latestTeam;

  const ranked = Array.from(candidate.observationsByTeam.entries()).sort((left, right) => {
    if (right[1].count !== left[1].count) return right[1].count - left[1].count;
    return right[1].latestUpdatedMs - left[1].latestUpdatedMs;
  });

  return ranked[0]?.[0] ?? null;
}

async function buildResolvedUpdates(candidates: Map<string, PlayerClubCandidate>): Promise<{
  updates: ResolvedPlayerClubUpdate[];
  unresolved: Array<{
    playerIdHint: string | null;
    playerName: string | null;
    team: string | null;
  }>;
}> {
  const prismaPlayers = await prisma.player.findMany({
    select: { id: true, name: true, club: true },
  });

  const playerById = new Map(prismaPlayers.map((player) => [player.id, player]));
  const playersByNormalizedName = new Map<string, Array<(typeof prismaPlayers)[number]>>();

  for (const player of prismaPlayers) {
    const key = normalizePlayerName(player.name);
    const existing = playersByNormalizedName.get(key) ?? [];
    existing.push(player);
    playersByNormalizedName.set(key, existing);
  }

  const updates: ResolvedPlayerClubUpdate[] = [];
  const unresolved: Array<{
    playerIdHint: string | null;
    playerName: string | null;
    team: string | null;
  }> = [];

  for (const candidate of candidates.values()) {
    const nextClub = chooseLatestTeam(candidate);
    if (!nextClub) continue;

    const resolvedById = candidate.playerIdHint
      ? (playerById.get(candidate.playerIdHint) ?? null)
      : null;
    const resolvedByName =
      !resolvedById && candidate.playerName
        ? (() => {
            const matches =
              playersByNormalizedName.get(normalizePlayerName(candidate.playerName)) ?? [];
            return matches.length === 1 ? matches[0] : null;
          })()
        : null;
    const resolvedPlayer = resolvedById ?? resolvedByName;

    if (!resolvedPlayer) {
      unresolved.push({
        playerIdHint: candidate.playerIdHint,
        playerName: candidate.playerName,
        team: nextClub,
      });
      continue;
    }

    if (normalizeTeamName(resolvedPlayer.club) === nextClub) {
      continue;
    }

    updates.push({
      playerId: resolvedPlayer.id,
      playerName: resolvedPlayer.name,
      fromClub: resolvedPlayer.club ?? null,
      toClub: nextClub,
      sourcePlayerIdHint: candidate.playerIdHint,
      sourceTeamCounts: Array.from(candidate.observationsByTeam.entries())
        .map(([team, observation]) => ({ team, count: observation.count }))
        .sort((left, right) => right.count - left.count || left.team.localeCompare(right.team)),
    });
  }

  return { updates, unresolved };
}

async function applyUpdates(
  updates: ResolvedPlayerClubUpdate[],
  dryRun: boolean,
  verbose: boolean
) {
  if (dryRun) {
    for (const update of updates) {
      if (verbose) {
        console.log(
          `[DRY RUN] ${update.playerName} (${update.playerId}): ${update.fromClub ?? 'UNKNOWN'} -> ${update.toClub}`
        );
      }
    }
    return;
  }

  for (const update of updates) {
    await prisma.player.update({
      where: { id: update.playerId },
      data: { club: update.toClub },
    });
  }

  const batchSizeLimit = 400;
  let batch = adminDb.batch();
  let batchCount = 0;

  for (const update of updates) {
    const ref = adminDb.collection('players').doc(update.playerId);
    batch.set(
      ref,
      {
        team: update.toClub,
        current_team: update.toClub,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batchCount += 1;

    if (batchCount >= batchSizeLimit) {
      await batch.commit();
      batch = adminDb.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(options.season) || options.season < 2000) {
    throw new Error(`Invalid season: ${options.season}`);
  }

  console.log(
    `Syncing player clubs from player_match_stats for season ${options.season}${options.dryRun ? ' (dry-run)' : ''}`
  );

  const candidates = await collectCandidates(options.season, options.limit);
  const { updates, unresolved } = await buildResolvedUpdates(candidates);

  console.log(`Observed club candidates for ${candidates.size} players.`);
  console.log(`Detected ${updates.length} player club updates.`);
  if (unresolved.length > 0) {
    console.log(`Skipped ${unresolved.length} unresolved players.`);
    if (options.verbose) {
      for (const item of unresolved.slice(0, 25)) {
        console.log(
          `  unresolved: ${item.playerName ?? item.playerIdHint ?? 'unknown'} -> ${item.team ?? 'unknown'}`
        );
      }
    }
  }

  if (options.verbose) {
    for (const update of updates.slice(0, 50)) {
      console.log(
        `  ${update.playerName} (${update.playerId}): ${update.fromClub ?? 'UNKNOWN'} -> ${update.toClub} [${update.sourceTeamCounts
          .map((entry) => `${entry.team}:${entry.count}`)
          .join(', ')}]`
      );
    }
  }

  await applyUpdates(updates, options.dryRun, options.verbose);

  console.log(
    `Done. ${options.dryRun ? 'No writes applied.' : 'Prisma and Firestore are now in sync for these players.'}`
  );
}

main()
  .catch((error) => {
    console.error('Failed to sync player clubs:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
