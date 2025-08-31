import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
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

// Persistent file-based store for player ranking preferences
// Keyed by `${draftId}:${memberId}`
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'user-rankings.json');

async function readStore(): Promise<Record<string, RankingPreferences>> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw) as Record<string, RankingPreferences>;
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, RankingPreferences>) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store), 'utf8');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const draftId = searchParams.get('draftId') || '';
  const memberId = searchParams.get('memberId') || '';
  const key = `${draftId}:${memberId}`;
  const store = await readStore();
  const data = store[key] || {};
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RankingPreferences;
  const { draftId, memberId } = body;
  if (!draftId || !memberId) {
    return NextResponse.json({ error: 'draftId and memberId required' }, { status: 400 });
  }
  const key = `${draftId}:${memberId}`;
  const store = await readStore();
  store[key] = body;
  await writeStore(store);
  return NextResponse.json({ success: true });
}
