import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';

const prisma = new PrismaClient();

async function main() {
  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);

  const playersMap = new Map<string, { id: string; name: string; club: string; position: string }>();

  for (const entry of data) {
    if (!playersMap.has(entry.Player)) {
      // Generate a unique ID based on player name
      const playerId = entry.Player.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      // Extract position from the data or default to a general position
      const position = entry.Position || 'UTIL'; // Fallback position
      
      playersMap.set(entry.Player, { 
        id: playerId,
        name: entry.Player, 
        club: entry.Team || 'UNK', // Use 'UNK' if team is missing
        position: position,
      });
    }
  }

  const players = Array.from(playersMap.values());

  console.log(`Seeding ${players.length} players...`);

  // Use upsert to handle potential duplicates
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
