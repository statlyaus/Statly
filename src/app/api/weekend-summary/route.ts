export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getPlayers } from '@/lib/data';
import { getTopPlayersByFantasy } from '@/lib/getTopPlayersByFantasy';
import { createOpenAIClient } from '@/lib/openaiClient';

const CACHE_PATH = '/tmp/weekend-summary.json';
const ONE_HOUR = 1000 * 60 * 60;

interface CachedSummary {
  summary: string;
  timestamp: number;
}

async function readCache(): Promise<CachedSummary | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CachedSummary;
    if (Date.now() - parsed.timestamp < ONE_HOUR) {
      return parsed;
    }
  } catch (_err) {
    // ignore missing/invalid cache
  }
  return null;
}

async function writeCache(summary: string) {
  const data: CachedSummary = { summary, timestamp: Date.now() };
  try {
    await fs.writeFile(CACHE_PATH, JSON.stringify(data), 'utf8');
  } catch (_err) {
    // ignore write errors
  }
}

export async function GET() {
  try {
    const cached = await readCache();
    if (cached) {
      return NextResponse.json(
        { summary: cached.summary },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    const players = await getPlayers();
    const top = getTopPlayersByFantasy(players, 5).map((p) => ({
      name: p.name,
      team: p.team,
      goals: p.stats?.goals,
      aflFantasy: p.stats?.aflFantasy,
    }));

    const client = createOpenAIClient();

    const prompt = `Provide a concise 2-3 sentence summary of the AFL weekend based on these top player stats: ${JSON.stringify(
      top
    )}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    const summary =
      completion.choices[0]?.message?.content?.trim() ||
      'No summary available.';

    await writeCache(summary);

    return NextResponse.json(
      { summary },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch (error) {
    console.error('weekend-summary error', error);
    return NextResponse.json(
      { summary: 'Summary unavailable' },
      { status: 500 }
    );
  }
}
