import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface RankingPreferences {
  draftId: string;
  memberId: string;
  excludedPlayers: string[];
  playerOrder: string[];
  watchlist: unknown[];
  preDraftQueue: unknown[];
  timestamp: number;
}

const DATA_PATH = path.join(process.cwd(), 'data', 'user-rankings.json');
let rankingStore: Map<string, RankingPreferences> | null = null;

async function loadStore() {
  if (rankingStore) return rankingStore;
  try {
    const file = await fs.readFile(DATA_PATH, 'utf-8');
    const json = JSON.parse(file) as Record<string, RankingPreferences>;
    rankingStore = new Map(Object.entries(json));
  } catch {
    rankingStore = new Map();
  }
  return rankingStore;
}

async function saveStore() {
  if (!rankingStore) return;
  const obj = Object.fromEntries(rankingStore);
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(obj, null, 2), 'utf-8');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const draftId = searchParams.get('draftId');
  const memberId = searchParams.get('memberId');
  if (!draftId || !memberId) {
    return NextResponse.json({ error: 'draftId and memberId required' }, { status: 400 });
  }
  const key = `${draftId}:${memberId}`;
  const store = await loadStore();
  const data = store.get(key) || {};
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RankingPreferences;
  const { draftId, memberId } = body;
  if (!draftId || !memberId) {
    return NextResponse.json({ error: 'draftId and memberId required' }, { status: 400 });
  }
  const key = `${draftId}:${memberId}`;
  const store = await loadStore();
  store.set(key, body);
  await saveStore();
  return NextResponse.json({ success: true });
}
