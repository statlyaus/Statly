#!/usr/bin/env node
import * as admin from 'firebase-admin';

type RawRow = Record<string, unknown>;

function initAdmin(): admin.firestore.Firestore {
  if (admin.apps.length) return admin.firestore();
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!serviceAccountBase64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
  }
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: String(serviceAccount.private_key).replace(/\\n/g, '\n'),
    }),
    projectId: serviceAccount.project_id,
  });

  return admin.firestore();
}

function parseSeasons(raw: string | undefined): number[] {
  const seasons = (raw ?? '2023,2024,2025')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return seasons.length > 0 ? seasons : [new Date().getFullYear()];
}

function toStr(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function pickRaw(row: RawRow | undefined, key: string): string | null {
  if (!row) return null;
  return toStr(row[key]);
}

function buildStartTime(dateStr: string | null, timeStr: string | null): string | null {
  if (!dateStr) return null;
  if (!timeStr) return `${dateStr}T00:00:00Z`;
  return `${dateStr}T${timeStr}Z`;
}

function deriveRoundNumber(row: RawRow, matchUid: string | null): number | null {
  const rawRound =
    row['match_round'] ??
    row['round'] ??
    row['round_number'] ??
    row['matchRound'] ??
    null;
  if (rawRound !== null && rawRound !== undefined) {
    const cleaned = String(rawRound).replace(/[^\d]/g, '');
    const n = parseInt(cleaned, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  if (matchUid) {
    const m = matchUid.match(/-R(\d+)-/i);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}

async function run(): Promise<void> {
  const db = initAdmin();
  const seasons = parseSeasons(process.env.SEASONS);

  console.log(`🧩 Backfilling matches from player_match_stats for seasons: ${seasons.join(', ')}`);

  for (const season of seasons) {
    const snap = await db
      .collection('player_match_stats')
      .where('season', '==', season)
      .select(
        'match_uid',
        'match_id',
        'matchUid',
        'matchId',
        'season',
        'round',
        'round_number',
        'team',
        'opposition',
        'raw_row'
      )
      .get();

    const matchMap = new Map<string, Record<string, unknown>>();

    for (const doc of snap.docs) {
      const data = doc.data();
      const raw = (data.raw_row ?? {}) as RawRow;
      const matchUid =
        toStr(data.match_uid) ||
        toStr(data.match_id) ||
        toStr(data.matchUid) ||
        toStr(data.matchId);
      if (!matchUid) continue;
      if (matchMap.has(matchUid)) continue;

      const seasonNum = toNumber(data.season) ?? season;
      const roundNum =
        deriveRoundNumber(raw, matchUid) ??
        toNumber(data.round_number) ??
        toNumber(data.round);
      if (roundNum === null) {
        console.warn(`Skipping match without round_number: ${matchUid}`);
        continue;
      }
      const homeTeam =
        pickRaw(raw, 'match_home_team') ||
        pickRaw(raw, 'match_home_team_1') ||
        (typeof data.team === 'string' ? data.team : null);
      const awayTeam =
        pickRaw(raw, 'match_away_team') ||
        pickRaw(raw, 'match_away_team_1') ||
        (typeof data.opposition === 'string' ? data.opposition : null);
      const matchDate = pickRaw(raw, 'match_date');
      const matchLocalTime = pickRaw(raw, 'match_local_time');
      const venue = pickRaw(raw, 'venue_name');
      const providerMatchId = pickRaw(raw, 'match_id');

      matchMap.set(matchUid, {
        season: seasonNum,
        round_number: roundNum,
        round: String(roundNum),
        home_team: homeTeam,
        away_team: awayTeam,
        match_date: matchDate,
        match_local_time: matchLocalTime,
        start_time_utc: buildStartTime(matchDate, matchLocalTime),
        venue,
        status: 'final',
        provider_ids: providerMatchId ? { fryzigg_match_id: providerMatchId } : {},
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(
      `Season ${season}: ${snap.size} stats docs scanned, ${matchMap.size} matches to upsert`
    );

    const writer = db.bulkWriter();
    for (const [matchUid, payload] of matchMap.entries()) {
      writer.set(db.collection('matches').doc(matchUid), payload, { merge: true });
    }
    await writer.close();
  }

  console.log('✅ Matches backfill complete.');
}

run().catch((error) => {
  console.error('❌ Matches backfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
