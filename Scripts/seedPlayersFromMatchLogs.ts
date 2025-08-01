// scripts/seedPlayersFromMatchLog.ts
import fs from 'fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccountRaw from '../serviceAccountKey.json' assert { type: 'json' };
import type { ServiceAccount } from 'firebase-admin';
import { z } from 'zod';

const serviceAccount = serviceAccountRaw as ServiceAccount;
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const MatchLogSchema = z.object({
  Player: z.string(),
  Team: z.string().optional(),
  Position: z.string().optional(),
});

function clean(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const raw = await fs.readFile('./player_stats_2025.json', 'utf-8');
const allLogs = JSON.parse(raw);

const uniquePlayers = new Map<string, { name: string; team?: string; position?: string }>();

for (const entry of allLogs) {
  const parsed = MatchLogSchema.safeParse(entry);
  if (!parsed.success) continue;
  const { Player, Team, Position } = parsed.data;
  const key = clean(Player);
  if (!uniquePlayers.has(key)) {
    uniquePlayers.set(key, {
      name: Player.trim(),
      team: Team?.trim(),
      position: Position?.trim(),
    });
  }
}

const playersSnapshot = await db.collection('players').get();
const existingNames = new Set(playersSnapshot.docs.map((doc) => clean(doc.data().name || '')));

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

console.log(`\n✅ Seeded ${created} new players. Skipped ${skipped} already existing.`);
