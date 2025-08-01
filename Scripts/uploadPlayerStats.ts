// scripts/uploadPlayerStats.ts
import fs from 'fs/promises';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { ServiceAccount } from 'firebase-admin';
import serviceAccountRaw from '../serviceAccountKey.json' assert { type: 'json' };

const serviceAccount = serviceAccountRaw as ServiceAccount;
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

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

function clean(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

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
    const raw = await fs.readFile('./player_stats_2025.json', 'utf-8');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) {
      throw new Error('Parsed data is not an array');
    }

    let added = 0;
    let updated = 0;

    for (const [i, entry] of rows.entries()) {
      const parsed = PlayerStatSchema.safeParse(entry);
      if (!parsed.success) {
        const playerName = (entry as any)?.Player ?? 'Unknown';
        console.warn(
          `⚠️ Invalid player entry at index ${i} (Player: ${playerName})`,
          parsed.error?.issues
        );
        continue;
      }

      const player = parsed.data;
      const cleanedName = clean(player.Player);

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

    console.log(`\n✅ Added ${added} new players, updated ${updated} existing.`);
  } catch (err) {
    console.error('❌ Error uploading player stats:', err);
  }
})();

process.on('unhandledRejection', (err) => {
  console.error('❌ Error uploading player stats:', err);
});
