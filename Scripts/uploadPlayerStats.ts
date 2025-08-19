// Scripts/uploadPlayerStats.ts
import { z } from 'zod';
import { cleanName, initFirestore, readJsonFile, logProgress, validateRequiredArgs } from './utils';

const db = initFirestore();

const PlayerStatSchema = z.object({
  Player: z.string(),
  Team: z.string(),
  AF: z.number().optional(),
  SC: z.number().optional(),
  G: z.number().optional(),
  M: z.number().optional(),
  Status: z.string().optional(),
  Position: z.string().optional(),
  Games: z.number().optional(),
});

interface PlayerPayload {
  name: string;
  displayName: string;
  team: string;
  stats: {
    AF: number | null;
    SC: number | null;
    G: number | null;
    M: number | null;
    Games: number | null;
  };
  position?: string;
  status?: string;
}

(async () => {
  try {
    validateRequiredArgs(process.argv, 1, 'npx tsx Scripts/uploadPlayerStats.ts <datasetPath>');
    const datasetPath = process.argv[2];

    logProgress('Starting player stats upload...', 'info');
    
    const rows: unknown = await readJsonFile<unknown[]>(datasetPath);
    if (!Array.isArray(rows)) {
      throw new Error('Parsed data is not an array');
    }

    let added = 0;
    let updated = 0;

    for (const [i, entry] of (rows as unknown[]).entries()) {
      const parsed = PlayerStatSchema.safeParse(entry);
      if (!parsed.success) {
        const playerName =
          typeof (entry as { Player?: unknown }).Player === 'string'
            ? (entry as { Player?: unknown }).Player
            : 'Unknown';
        logProgress(`Invalid player entry at index ${i} (Player: ${playerName})`, 'warning');
        continue;
      }

      const player = parsed.data;
      const cleanedName = cleanName(player.Player);

      const snapshot = await db
        .collection('players')
        .where('name', '==', cleanedName)
        .limit(1)
        .get();

      const payload: PlayerPayload = {
        name: cleanedName,
        displayName: player.Player,
        team: player.Team,
        stats: {
          AF: player.AF ?? null,
          SC: player.SC ?? null,
          G: player.G ?? null,
          M: player.M ?? null,
          Games: player.Games ?? null,
        },
      };

      if (player.Position) payload.position = player.Position;
      if (player.Status) payload.status = player.Status;

      if (snapshot.empty) {
        await db.collection('players').add(payload);
        added++;
      } else {
        const doc = snapshot.docs[0];
        await doc.ref.set(payload, { merge: true });
        updated++;
      }
    }

    logProgress(`Added ${added} new players, updated ${updated} existing.`, 'success');
  } catch (err) {
    logProgress(`Error uploading player stats: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
})();
