// scripts/uploadMatchLogs.ts
import { z } from 'zod';
import { cleanName, initFirestore, readJsonFile, logProgress, validateRequiredArgs } from './utils';

const db = initFirestore();

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

type MatchLog = {
  matchId: number;
  date: string;
  round: string;
  venue: string;
  opponent: string;
  status: string;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  hitouts: number;
  goals: number;
  behinds: number;
  clearances: number;
  clangers: number;
  contested_possessions: number;
  uncontested_possessions: number;
  intercepts: number;
  metres_gained: number;
  disposal_efficiency: number;
  effective_disposals: number;
  centre_clearances: number;
  stoppage_clearances: number;
  score_involvements: number;
  tackles_inside_50: number;
  marks_inside_50: number;
  contested_marks: number;
  bounces: number;
  goal_assists: number;
  one_percenters: number;
  time_on_ground: number;
  team: string;
};

async function main() {
  try {
    validateRequiredArgs(process.argv, 1, 'npx tsx Scripts/uploadMatchLogs.ts <datasetPath>');
    const datasetPath = process.argv[2];

    logProgress('Starting match logs upload...', 'info');

    const allLogs = await readJsonFile<unknown[]>(datasetPath);
    const logsByPlayer = new Map<string, MatchLog[]>();

    for (const entry of allLogs) {
      const parsed = MatchLogSchema.safeParse(entry);
      if (!parsed.success) {
        logProgress('Invalid match log entry shape', 'warning');
        continue;
      }
      const data = parsed.data;
      const name = cleanName(data.Player);
      const log: MatchLog = {
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
      const existingLogs: MatchLog[] = snapshot.data()?.matchLogs ?? [];
      const existingIds = new Set(existingLogs.map((l) => l.matchId));

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
  } catch (err) {
    logProgress(`Error uploading match logs: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

main();
