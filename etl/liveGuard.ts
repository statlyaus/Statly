import { getFirestore } from "firebase-admin/firestore";

export interface MatchStatus {
  matchUid: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: "scheduled" | "in_progress" | "final";
  provider_ids?: {
    afl?: string;
    footywire?: string;
    afltables?: string;
    squiggle?: number;
  };
}

export interface PlayerInfo {
  playerUid: string;
  full_name: string;
  current_team: string;
  positions: string[];
  provider_ids?: {
    footywire?: number;
    afltables?: number;
    afl?: string;
  };
}

export interface PlayerMatchStats {
  match_uid: string;
  player_uid: string;
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string;
  raw_checksum: string;
  stats: {
    kicks?: number | null;
    handballs?: number | null;
    disposals?: number | null;
    marks?: number | null;
    tackles?: number | null;
    goals?: number | null;
    behinds?: number | null;
    hitouts?: number | null;
    clearances?: number | null;
    inside50s?: number | null;
    rebound50s?: number | null;
    clangers?: number | null;
    contested_possessions?: number | null;
    uncontested_possessions?: number | null;
    frees_for?: number | null;
    frees_against?: number | null;
    one_percenters?: number | null;
    goal_assists?: number | null;
    turnovers?: number | null;
    intercepts?: number | null;
    metres_gained?: number | null;
    contested_marks?: number | null;
    effective_disposals?: number | null;
    score_involvements?: number | null;
    minutes?: number | null;
    tog_pct?: number | null;
  };
}

// Decide if any matches are live right now
export async function isLiveWindow(): Promise<boolean> {
  const db = getFirestore();
  const snap = await db.collection("matches")
    .where("status", "==", "in_progress")
    .limit(1).get();
  return !snap.empty;
}

// Get all live matches
export async function getLiveMatches(): Promise<MatchStatus[]> {
  const db = getFirestore();
  const snap = await db.collection("matches")
    .where("status", "==", "in_progress")
    .get();
  
  return snap.docs.map(doc => ({
    matchUid: doc.id,
    ...doc.data()
  } as MatchStatus));
}

// Update match status
export async function updateMatchStatus(
  matchUid: string, 
  status: "scheduled" | "in_progress" | "final"
): Promise<void> {
  const db = getFirestore();
  await db.collection("matches").doc(matchUid).update({
    status,
    updated_at: new Date().toISOString()
  });
}

// Get latest stats for a match
export async function getMatchStats(matchUid: string): Promise<PlayerMatchStats[]> {
  const db = getFirestore();
  const snap = await db.collection("player_match_stats")
    .where("match_uid", "==", matchUid)
    .get();
  
  return snap.docs.map(doc => doc.data() as PlayerMatchStats);
}

// Get player stats for a round
export async function getRoundStats(season: number, round: number): Promise<PlayerMatchStats[]> {
  const db = getFirestore();
  const snap = await db.collection("player_match_stats")
    .where("season", "==", season)
    .where("round_number", "==", round)
    .get();
  
  return snap.docs.map(doc => doc.data() as PlayerMatchStats);
}

// Upsert player info
export async function upsertPlayer(player: PlayerInfo): Promise<void> {
  const db = getFirestore();
  await db.collection("players").doc(player.playerUid).set(player, { merge: true });
}

// Upsert match info
export async function upsertMatch(match: MatchStatus): Promise<void> {
  const db = getFirestore();
  await db.collection("matches").doc(match.matchUid).set(match, { merge: true });
}
