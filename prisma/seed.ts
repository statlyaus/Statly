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
  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);
  const supplementalProfiles = await loadSupplementalSeedProfiles();

  const playersMap = new Map<
    string,
    { id: string; name: string; club: string; explicitPosition: string | null; rows: unknown[] }
  >();

  for (const entry of data) {
    const playerName = typeof entry.Player === 'string' ? entry.Player.trim() : '';
    if (!playerName) continue;

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

  console.log(`Seeding ${players.length} players...`);
  for (const player of players) {
    await prisma.player.upsert({
      where: { id: player.id },
      update: {
        name: player.name,
        club: player.club,
        position: player.position,
        active: true,
      },
      create: {
        id: player.id,
        name: player.name,
        club: player.club,
        position: player.position,
        active: true,
      },
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
