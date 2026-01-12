// src/app/api/scheduling/generate/route.ts
import { NextResponse } from 'next/server';

import { commonErrors } from '@/lib/apiResponse';
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
    return commonErrors.badRequest('Invalid JSON in request body');
  }

  if (!body || typeof body !== 'object') {
    return commonErrors.badRequest('Request body must be a valid object');
  }

  const validation = validateLeagueSettings(body);
  if (!validation.isValid) {
    return commonErrors.badRequest(validation.errors.join(', '));
  }

  try {
    const result = generateCompleteSchedule(body);
    return NextResponse.json(result);
  } catch (error) {
    return commonErrors.internalServerError(
      error instanceof Error ? error.message : 'Schedule generation failed'
    );
  }
}
