export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { env } from '@/lib/env';

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

    // Fetch data from our own API endpoint
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/player-stats?season=2025&limit=10`);
    if (!response.ok) {
      throw new Error(`Failed to fetch player stats: ${response.status}`);
    }
    
    const { data: players } = await response.json();
    
    // Get top 5 players by total value (our 9-category score)
    const top = players
      .sort((a: any, b: any) => (b.totalValue || 0) - (a.totalValue || 0))
      .slice(0, 5)
      .map((p: any) => ({
        name: p.playerName,
        team: p.team,
        round: p.round,
        goals: p.goals,
        tackles: p.tackles,
        totalValue: p.totalValue,
      }));

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY ?? env.GITHUB_TOKEN,
      baseURL: env.OPENAI_BASE_URL,
    });

    const prompt = `Provide a concise 2-3 sentence summary of the AFL weekend based on these top performing players using our 9-category scoring system (goals, tackles, inside 50s, intercepts, contested marks, rebound 50s, contested possessions, effective disposals, score involvements): ${JSON.stringify(
      top
    )}. Focus on standout performances and key contributions.`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    const summary =
      completion.choices[0]?.message?.content?.trim() ||
      'No summary available for this AFL weekend.';

    cache = { summary, timestamp: now };

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('weekend-summary error', error);
    return NextResponse.json(
      { summary: 'Weekend summary temporarily unavailable. Check back soon for the latest AFL highlights!' },
      { status: 500 }
    );
  }
}
