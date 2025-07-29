// scripts/seedPlayers.ts
import fs from 'fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import serviceAccountRaw from '../serviceAccountKey.json' assert { type: 'json' };
import type { ServiceAccount } from 'firebase-admin';

const serviceAccount = serviceAccountRaw as ServiceAccount;
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  position: z.string().optional(),
  avg: z.number().optional(),
  games: z.number().optional(),
  status: z.string().optional(),
});

function clean(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const raw = await fs.readFile('./players_2025.json', 'utf-8');
const allPlayers = JSON.parse(raw);

const existingSnapshot = await db.collection('players').get();
const nameToId = new Map<string, string>();
for (const doc of existingSnapshot.docs) {
  const data = doc.data();
  if (data.name) nameToId.set(clean(data.name), doc.id);
}

let created = 0;
let updated = 0;

for (const entry of allPlayers) {
  const parsed = PlayerSchema.safeParse(entry);
  if (!parsed.success) {
    console.warn('⚠️ Invalid player entry:', parsed.error.issues);
    continue;
  }

  const data = parsed.data;
  const cleanedName = clean(data.name);
  const docId = nameToId.get(cleanedName);

  if (docId) {
    await db.collection('players').doc(docId).set(data, { merge: true });
    updated++;
  } else {
    await db.collection('players').add(data);
    created++;
  }
}

console.log(`✅ Seeded players: ${created} new, ${updated} updated.`);