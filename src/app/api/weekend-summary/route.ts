export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getPlayers } from '@/lib/data';
import { getTopPlayersByFantasy } from '@/lib/getTopPlayersByFantasy';

interface CachedSummary {
  summary: string;
  timestamp: number;
}

let cache: CachedSummary | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cache && now - cache.timestamp < 1000 * 60 * 60) {
      return NextResponse.json({ summary: cache.summary });
    }

    const players = await getPlayers();
    const top = getTopPlayersByFantasy(players, 5).map((p) => ({
      name: p.name,
      team: p.team,
      goals: p.stats?.goals,
      aflFantasy: p.stats?.aflFantasy,
    }));

    const client = new OpenAI({
      apiKey: process.env.GITHUB_TOKEN,
      baseURL: process.env.OPENAI_BASE_URL || 'https://models.inference.ai.azure.com',
    });

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

    cache = { summary, timestamp: now };

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('weekend-summary error', error);
    return NextResponse.json(
      { summary: 'Summary unavailable' },
      { status: 500 }
    );
  }
}
