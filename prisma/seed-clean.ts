import '../src/lib/loadEnv';

import fs from 'fs/promises';

import { PrismaClient } from '@prisma/client';

import { buildCanonicalPlayerId } from '../src/lib/playerIdentity';
import { getExactMappedPlayerPosition } from '../src/lib/playerPositionMapping';
import { buildSeedProfileKey, loadSupplementalSeedProfiles } from '../src/lib/playerSeedProfiles';
import {
  aggregatePlayerSeedStats,
  inferPositionFromSeedStats,
  normalizeAflPosition,
} from '../src/lib/playerSeedPosition';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);
  const supplementalProfiles = await loadSupplementalSeedProfiles();

  const playersMap = new Map<
    string,
    { id: string; name: string; club: string; explicitPosition: string | null; rows: unknown[] }
  >();

  for (const entry of data) {
    const playerName = entry.Player?.trim();

    if (!playerName) {
      continue;
    }

    const existing = playersMap.get(playerName);
    if (existing) {
      existing.rows.push(entry);
      if (
        !existing.explicitPosition &&
        typeof entry.Position === 'string' &&
        entry.Position.trim()
      ) {
        existing.explicitPosition = entry.Position.trim();
      }
      if ((!existing.club || existing.club === 'UNK') && entry.Team) {
        existing.club = entry.Team;
      }
      continue;
    }

    playersMap.set(playerName, {
      id: buildCanonicalPlayerId(playerName),
      name: playerName,
      club: entry.Team || 'UNK',
      explicitPosition:
        typeof entry.Position === 'string' && entry.Position.trim() ? entry.Position.trim() : null,
      rows: [entry],
    });
  }

  const players = Array.from(playersMap.values()).map((player) => {
    const aggregate = aggregatePlayerSeedStats(player.rows as Record<string, unknown>[]);
    const explicit = normalizeAflPosition(player.explicitPosition);
    const supplemental =
      supplementalProfiles.get(buildSeedProfileKey(player.name))?.position ?? null;
    const mapped = normalizeAflPosition(getExactMappedPlayerPosition(player.name));
    const inferred = inferPositionFromSeedStats(aggregate);

    return {
      id: player.id,
      name: player.name,
      club: player.club,
      position: explicit ?? supplemental ?? mapped ?? inferred ?? 'MID',
    };
  });

  console.log(`📊 Found ${players.length} unique players to seed`);
  console.log(`📈 Processed ${data.length} total data entries`);

  // Clear existing players first
  console.log('🗑️  Clearing existing player data...');
  await prisma.pick.deleteMany({});
  await prisma.player.deleteMany({});

  console.log('📥 Seeding players...');

  // Batch insert for better performance
  const batchSize = 100;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);

    await prisma.player.createMany({
      data: batch.map((player) => ({
        id: player.id,
        name: player.name,
        club: player.club,
        position: player.position,
        active: true,
      })),
    });

    console.log(
      `✅ Seeded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)}`
    );
  }

  console.log('🎉 Seeding completed successfully!');
  console.log(`📊 Total unique players in database: ${players.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
