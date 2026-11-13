import { NextResponse } from 'next/server';

import type { BiteError } from '@/server/leagues/bloodsuckerBites';
import type { RosterSwapError } from '@/server/leagues/rosterSwap';

export const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** Every bite refusal names its code and reason (NFR-5). */
export function biteErrorResponse(error: BiteError | RosterSwapError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: privateHeaders }
  );
}
