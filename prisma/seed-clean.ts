import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import { getPlayerPosition } from '../src/lib/playerPositionMapping';
import { buildCanonicalPlayerId } from '../src/lib/playerIdentity';
import {
  PLAYER_STATS_2025_PROVIDER,
  upsertCanonicalPlayer,
} from '../src/server/players/playerIdentityService';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);

  const playersMap = new Map<string, { name: string; club: string; position: string }>();

  for (const entry of data) {
    const playerName = entry.Player?.trim();

    if (!playerName || playersMap.has(playerName)) {
      continue; // Skip empty names or already processed players
    }

    // Extract position from the data or use smart position mapping
    const position = entry.Position || getPlayerPosition(playerName);
    const club = entry.Team || 'UNK';

    playersMap.set(playerName, {
      name: playerName,
      club: club,
      position: position,
    });
  }

  const players = Array.from(playersMap.values());

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

    for (const player of batch) {
      await upsertCanonicalPlayer(prisma, {
        provider: PLAYER_STATS_2025_PROVIDER,
        externalId: buildCanonicalPlayerId(`${player.name}|${player.club}`),
        name: player.name,
        club: player.club,
        position: player.position,
        active: true,
        allowExactAttributeMatch: true,
      });
    }

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
