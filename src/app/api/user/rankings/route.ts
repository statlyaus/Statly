import { NextRequest, NextResponse } from 'next/server';

// In-memory store for player ranking preferences
// Keyed by `${draftId}:${memberId}`
const rankingStore = new Map<string, any>();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const draftId = searchParams.get('draftId') || '';
  const memberId = searchParams.get('memberId') || '';
  const key = `${draftId}:${memberId}`;
  const data = rankingStore.get(key) || {};
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { draftId, memberId } = body;
  if (!draftId || !memberId) {
    return NextResponse.json({ error: 'draftId and memberId required' }, { status: 400 });
  }
  const key = `${draftId}:${memberId}`;
  rankingStore.set(key, body);
  return NextResponse.json({ success: true });
}
