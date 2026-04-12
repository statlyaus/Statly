#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import {
  createPlayerDirectory,
  type PlayerDirectoryEntry,
  type PlayerDirectory,
  resolvePlayerDirectoryEntry,
} from '../src/lib/playerMatchStats';
import { prisma } from '../src/lib/prisma';
import { getServiceAccountFromEnv } from '../src/lib/serviceAccount';

type Options = {
  season: number;
  dryRun: boolean;
  limit?: number;
  rewriteExisting: boolean;
  verbose: boolean;
};

type UnresolvedIdentity = {
  playerName: string;
  team: string;
  docIds: string[];
};

function parseArgs(argv: string[]): Options {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? Number(limitArg) : undefined;

  return {
    season: seasonArg ? Number(seasonArg) : getDefaultAflSeason(),
    dryRun: argv.includes('--dry-run'),
    rewriteExisting: argv.includes('--rewrite-existing'),
    verbose: argv.includes('--verbose'),
    limit: Number.isFinite(limit) && limit && limit > 0 ? limit : undefined,
  };
}

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

async function buildPlayerDirectory(): Promise<PlayerDirectory> {
  const [snapshot, prismaPlayers] = await Promise.all([
    adminDb.collection('players').get(),
    prisma.player.findMany({
      select: {
        id: true,
        name: true,
        club: true,
      },
    }),
  ]);

  return createPlayerDirectory([
    ...snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        name: String(data.name ?? data.player_name ?? '').trim(),
        team:
          typeof data.team === 'string'
            ? data.team
            : typeof data.club === 'string'
              ? data.club
              : undefined,
      };
    }),
    ...prismaPlayers.map((player) => ({
      id: player.id,
      name: player.name.trim(),
      club: player.club,
    })),
  ]);
}

function collectCandidateEntries(
  directory: PlayerDirectory,
  playerName: string,
  team: string
): PlayerDirectoryEntry[] {
  const candidates = new Map<string, PlayerDirectoryEntry>();

  for (const entry of directory.byName.values()) {
    if (
      entry.name.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(entry.name.toLowerCase())
    ) {
      candidates.set(entry.id, entry);
    }
  }

  for (const [key, entry] of directory.byNameAndTeam.entries()) {
    if (
      key.includes(playerName.toLowerCase()) ||
      entry.name.toLowerCase().includes(playerName.toLowerCase())
    ) {
      candidates.set(entry.id, entry);
    }
  }

  return Array.from(candidates.values()).sort((left, right) => {
    const leftTeamMatch = left.normalizedTeam === team.toLowerCase();
    const rightTeamMatch = right.normalizedTeam === team.toLowerCase();
    if (leftTeamMatch !== rightTeamMatch) return leftTeamMatch ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const directory = await buildPlayerDirectory();

  console.log(
    `Backfilling player_match_stats IDs for season ${options.season}${options.dryRun ? ' (dry-run)' : ''}`
  );
  if (options.rewriteExisting) {
    console.log('Mode: rewrite existing player_id fields');
  }

  const snapshot = await adminDb
    .collection('player_match_stats')
    .where('season', '==', options.season)
    .get();

  const writer = adminDb.bulkWriter();
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let unresolved = 0;
  const unresolvedSamples: string[] = [];
  const unresolvedByIdentity = new Map<string, UnresolvedIdentity>();

  try {
    for (const doc of snapshot.docs) {
      if (typeof options.limit === 'number' && scanned >= options.limit) break;
      scanned += 1;

      const data = doc.data() as Record<string, unknown>;
      const existingPlayerId =
        typeof data.player_id === 'string'
          ? data.player_id.trim()
          : typeof data.playerId === 'string'
            ? data.playerId.trim()
            : '';

      if (existingPlayerId && !options.rewriteExisting) {
        skipped += 1;
        continue;
      }

      const playerName = String(data.player_name ?? '').trim();
      const team =
        typeof data.team === 'string' ? data.team : typeof data.club === 'string' ? data.club : '';

      const resolvedPlayerId = resolvePlayerDirectoryEntry(directory, playerName, team)?.id ?? null;
      if (!resolvedPlayerId) {
        unresolved += 1;
        const identityKey = `${playerName || 'unknown'}|${team || 'unknown'}`;
        const existing = unresolvedByIdentity.get(identityKey);
        if (existing) {
          existing.docIds.push(doc.id);
        } else {
          unresolvedByIdentity.set(identityKey, {
            playerName: playerName || 'unknown',
            team: team || 'unknown',
            docIds: [doc.id],
          });
        }
        if (unresolvedSamples.length < 10) {
          unresolvedSamples.push(`${playerName || 'unknown'} (${team || 'unknown'}) -> ${doc.id}`);
        }
        continue;
      }

      if (existingPlayerId === resolvedPlayerId) {
        skipped += 1;
        continue;
      }

      if (options.verbose) {
        console.log(`${doc.id}: ${existingPlayerId || 'missing'} -> ${resolvedPlayerId}`);
      }

      updated += 1;
      if (!options.dryRun) {
        writer.set(
          doc.ref,
          {
            player_id: resolvedPlayerId,
            playerId: resolvedPlayerId,
          },
          { merge: true }
        );
      }
    }
  } finally {
    await writer.close();
  }

  console.log('');
  console.log(`Scanned: ${scanned}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Unresolved: ${unresolved}`);

  if (unresolvedSamples.length > 0) {
    console.log('');
    console.log('Sample unresolved rows:');
    unresolvedSamples.forEach((sample) => console.log(`  ${sample}`));
  }

  if (unresolvedByIdentity.size > 0) {
    console.log('');
    console.log('Grouped unresolved identities:');
    const groupedIdentities = Array.from(unresolvedByIdentity.values()).sort((left, right) => {
      if (right.docIds.length !== left.docIds.length)
        return right.docIds.length - left.docIds.length;
      if (left.team !== right.team) return left.team.localeCompare(right.team);
      return left.playerName.localeCompare(right.playerName);
    });

    for (const entry of groupedIdentities) {
      const candidates = collectCandidateEntries(directory, entry.playerName, entry.team)
        .slice(0, 3)
        .map((candidate) => `${candidate.name} [${candidate.id}]`);
      console.log(`  ${entry.playerName} (${entry.team}) -> ${entry.docIds.length} rows`);
      console.log(
        `    docs: ${entry.docIds.slice(0, 3).join(', ')}${entry.docIds.length > 3 ? ', ...' : ''}`
      );
      console.log(`    candidates: ${candidates.length > 0 ? candidates.join(' | ') : 'none'}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
