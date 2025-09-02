// src/app/api/scheduling/generate/route.ts
import { NextResponse } from 'next/server';
import {
  generateCompleteSchedule,
  validateLeagueSettings,
  type LeagueSettings,
} from '@/lib/scheduling';

export async function POST(request: Request) {
  let body: LeagueSettings;

  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON in request body' },
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Request body must be a valid object' },
      { status: 400 }
    );
  }

  const validation = validateLeagueSettings(body);
  if (!validation.isValid) {
    return NextResponse.json(
      { success: false, error: validation.errors.join(', ') },
      { status: 400 }
    );
  }

  try {
    const result = generateCompleteSchedule(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Schedule generation failed',
      },
      { status: 500 }
    );
  }
}
