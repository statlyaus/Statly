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

const DATA_FILE = path.join(process.cwd(), 'data', 'rankings.json');

async function readStore(): Promise<Record<string, RankingPreferences>> {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(content) as Record<string, RankingPreferences>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

async function writeStore(store: Record<string, RankingPreferences>) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
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
