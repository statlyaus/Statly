import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import { buildCanonicalPlayerId } from '../src/lib/playerIdentity';
import {
  PLAYER_STATS_2025_PROVIDER,
  STATLY_LEGACY_PLAYER_PROVIDER,
  upsertCanonicalPlayer,
} from '../src/server/players/playerIdentityService';

const prisma = new PrismaClient();

async function main() {
  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);

  const playersMap = new Map<string, { name: string; club: string; position: string }>();

  for (const entry of data) {
    if (!playersMap.has(entry.Player)) {
      // Extract position from the data or default to a general position
      const position = entry.Position || 'UTIL'; // Fallback position

      playersMap.set(entry.Player, {
        name: entry.Player,
        club: entry.Team || 'UNK', // Use 'UNK' if team is missing
        position: position,
      });
    }
  }

  const players = Array.from(playersMap.values());

  console.log(`Seeding ${players.length} players...`);

  // Resolve the source identity before writing so re-seeding cannot create a
  // second Player row with a different ID convention.
  for (const player of players) {
    const canonicalPlayer = await upsertCanonicalPlayer(prisma, {
      provider: PLAYER_STATS_2025_PROVIDER,
      externalId: buildCanonicalPlayerId(`${player.name}|${player.club}`),
      name: player.name,
      club: player.club,
      position: player.position,
      active: true,
      allowExactAttributeMatch: true,
    });
    await upsertCanonicalPlayer(prisma, {
      provider: STATLY_LEGACY_PLAYER_PROVIDER,
      externalId: buildCanonicalPlayerId(player.name),
      canonicalPlayerId: canonicalPlayer.id,
      name: player.name,
      club: player.club,
      position: player.position,
      active: true,
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
