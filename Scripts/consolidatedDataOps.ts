import { initFirestore, readJsonFile, cleanName, logProgress, validateRequiredArgs } from './utils';
import { z } from 'zod';

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

const MatchLogSchema = z.object({
  Match_id: z.number(),
  Date: z.string(),
  Round: z.string(),
  Venue: z.string(),
  Opposition: z.string(),
  Status: z.string(),
  K: z.number(),
  HB: z.number(),
  D: z.number(),
  M: z.number(),
  T: z.number(),
  HO: z.number(),
  G: z.number(),
  B: z.number(),
  CL: z.number(),
  CG: z.number(),
  CP: z.number(),
  UP: z.number(),
  ITC: z.number(),
  MG: z.number(),
  DE: z.number(),
  ED: z.number(),
  CCL: z.number(),
  SCL: z.number(),
  SI: z.number(),
  T5: z.number(),
  MI5: z.number(),
  CM: z.number(),
  BO: z.number(),
  GA: z.number(),
  One: z.object({ Percenters: z.number() }).optional(),
  TOG: z.number(),
  Team: z.string(),
  Player: z.string(),
});

async function uploadPlayerStats(datasetPath: string) {
  logProgress('Starting player stats upload...', 'info');
  
  const rows: unknown = await readJsonFile<unknown[]>(datasetPath);
  if (!Array.isArray(rows)) {
    throw new Error('Parsed data is not an array');
  }

  let added = 0;
  let updated = 0;

  for (const [i, entry] of rows.entries()) {
    const parsed = PlayerStatSchema.safeParse(entry);
    if (!parsed.success) {
      const playerName = typeof (entry as { Player?: unknown }).Player === 'string'
        ? (entry as { Player?: unknown }).Player
        : 'Unknown';
      logProgress(`Invalid player entry at index ${i} (Player: ${playerName})`, 'warning');
      continue;
    }

    const player = parsed.data;
    const cleanedName = cleanName(player.Player);

    const snapshot = await db.collection('players').where('name', '==', cleanedName).limit(1).get();

    const payload = {
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
      ...(player.Position && { position: player.Position }),
      ...(player.Status && { status: player.Status }),
    };

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
}

async function uploadMatchLogs(datasetPath: string) {
  logProgress('Starting match logs upload...', 'info');
  
  const allLogs = await readJsonFile<unknown[]>(datasetPath);
  const logsByPlayer = new Map<string, any[]>();

  // Process and group logs by player
  for (const entry of allLogs) {
    const parsed = MatchLogSchema.safeParse(entry);
    if (!parsed.success) {
      logProgress('Invalid match log entry shape', 'warning');
      continue;
    }
    
    const data = parsed.data;
    const name = cleanName(data.Player);
    const log = {
      matchId: data.Match_id,
      date: data.Date,
      round: data.Round,
      venue: data.Venue,
      opponent: data.Opposition,
      status: data.Status,
      kicks: data.K,
      handballs: data.HB,
      disposals: data.D,
      marks: data.M,
      tackles: data.T,
      hitouts: data.HO,
      goals: data.G,
      behinds: data.B,
      clearances: data.CL,
      clangers: data.CG,
      contested_possessions: data.CP,
      uncontested_possessions: data.UP,
      intercepts: data.ITC,
      metres_gained: data.MG,
      disposal_efficiency: data.DE,
      effective_disposals: data.ED,
      centre_clearances: data.CCL,
      stoppage_clearances: data.SCL,
      score_involvements: data.SI,
      tackles_inside_50: data.T5,
      marks_inside_50: data.MI5,
      contested_marks: data.CM,
      bounces: data.BO,
      goal_assists: data.GA,
      one_percenters: data.One?.Percenters ?? 0,
      time_on_ground: data.TOG,
      team: data.Team,
    };
    
    if (!logsByPlayer.has(name)) logsByPlayer.set(name, []);
    logsByPlayer.get(name)!.push(log);
  }

  // Update player documents
  const playersSnapshot = await db.collection('players').get();
  const nameToId = new Map<string, string>();
  
  for (const doc of playersSnapshot.docs) {
    const data = doc.data();
    if (data.name) {
      nameToId.set(cleanName(data.name), doc.id);
    }
  }

  let updated = 0;
  let created = 0;

  for (const [cleanedName, newLogs] of logsByPlayer) {
    let playerId = nameToId.get(cleanedName);
    if (!playerId) {
      const ref = await db.collection('players').add({ name: cleanedName });
      playerId = ref.id;
      nameToId.set(cleanedName, playerId);
      created++;
    }

    const playerRef = db.collection('players').doc(playerId);
    const snapshot = await playerRef.get();
    const existingLogs = snapshot.data()?.matchLogs ?? [];
    const existingIds = new Set(existingLogs.map((l: any) => l.matchId));

    const dedupedLogs = [...existingLogs];
    for (const log of newLogs) {
      if (!existingIds.has(log.matchId)) {
        dedupedLogs.push(log);
      }
    }

    dedupedLogs.sort((a, b) => a.date.localeCompare(b.date));
    await playerRef.set({ matchLogs: dedupedLogs }, { merge: true });
    updated++;
  }

  logProgress(`Match logs updated for ${updated} players.`, 'success');
  if (created > 0) logProgress(`Created ${created} new players.`, 'info');
}

// Main execution
async function main() {
  const operation = process.argv[2];
  const datasetPath = process.argv[3];

  if (!operation || !datasetPath) {
    console.error('Usage: npx tsx Scripts/consolidatedDataOps.ts <operation> <datasetPath>');
    console.error('Operations: upload-stats, upload-logs');
    process.exit(1);
  }

  try {
    switch (operation) {
      case 'upload-stats':
        await uploadPlayerStats(datasetPath);
        break;
      case 'upload-logs':
        await uploadMatchLogs(datasetPath);
        break;
      default:
        logProgress(`Unknown operation: ${operation}`, 'error');
        process.exit(1);
    }
  } catch (err) {
    logProgress(`Error in ${operation}: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
