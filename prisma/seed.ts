import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';

const prisma = new PrismaClient();

async function main() {
  const raw = await fs.readFile('player_stats_2025.json', 'utf8');
  const data = JSON.parse(raw);

  const playersMap = new Map<string, { name: string; aflTeam: string }>();

  for (const entry of data) {
    if (!playersMap.has(entry.Player)) {
      playersMap.set(entry.Player, { name: entry.Player, aflTeam: entry.Team });
    }
  }

  const players = Array.from(playersMap.values());

  await prisma.player.createMany({
    data: players,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
