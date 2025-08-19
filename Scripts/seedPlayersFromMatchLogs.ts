// scripts/seedPlayersFromMatchLog.ts
import { z } from 'zod';
import { cleanName, initFirestore, readJsonFile, logProgress, validateRequiredArgs } from './utils';

const db = initFirestore();

const MatchLogSchema = z.object({
  Player: z.string(),
  Team: z.string().optional(),
  Position: z.string().optional(),
});

async function main() {
  try {
    validateRequiredArgs(process.argv, 1, 'npx tsx Scripts/seedPlayersFromMatchLogs.ts <datasetPath>');
    const datasetPath = process.argv[2];

    logProgress('Starting player seeding from match logs...', 'info');

    const allLogs = await readJsonFile<unknown[]>(datasetPath);
    const uniquePlayers = new Map<string, { name: string; team?: string; position?: string }>();

    for (const entry of allLogs) {
      const parsed = MatchLogSchema.safeParse(entry);
      if (!parsed.success) continue;
      const { Player, Team, Position } = parsed.data;
      const key = cleanName(Player);
      if (!uniquePlayers.has(key)) {
        uniquePlayers.set(key, {
          name: Player.trim(),
          team: Team?.trim(),
          position: Position?.trim(),
        });
      }
    }

    const playersSnapshot = await db.collection('players').get();
    const existingNames = new Set(playersSnapshot.docs.map((doc) => cleanName(doc.data().name || '')));

    let created = 0;
    let skipped = 0;

    for (const [cleanedName, player] of uniquePlayers) {
      if (existingNames.has(cleanedName)) {
        skipped++;
        continue;
      }
      await db.collection('players').add({
        name: player.name,
        team: player.team || null,
        position: player.position || null,
        createdAt: new Date().toISOString(),
      });
      created++;
    }

    logProgress(`Seeded ${created} new players. Skipped ${skipped} existing.`, 'success');
  } catch (err) {
    logProgress(`Error seeding players: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

main();
