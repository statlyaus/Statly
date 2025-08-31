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

const DATA_PATH = path.join(process.cwd(), 'data', 'user-rankings.json');

async function readStore(): Promise<Record<string, RankingPreferences>> {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
      await fs.writeFile(DATA_PATH, '{}');
      return {};
    }
    throw err;
  }
}

async function writeStore(store: Record<string, RankingPreferences>): Promise<void> {
  await fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const draftId = searchParams.get('draftId');
  const memberId = searchParams.get('memberId');
  if (!draftId || !memberId) {
    return NextResponse.json(
      { error: 'draftId and memberId required' },
      { status: 400 }
    );
  }
  const key = `${draftId}:${memberId}`;
  const store = await readStore();
  const data = store[key] || {};
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RankingPreferences;
  const { draftId, memberId } = body;
  if (!draftId || !memberId) {
    return NextResponse.json(
      { error: 'draftId and memberId required' },
      { status: 400 }
    );
  }
  const key = `${draftId}:${memberId}`;
  const store = await readStore();
  store[key] = { ...body, timestamp: body.timestamp ?? Date.now() };
  await writeStore(store);
  return NextResponse.json({ success: true });
}
