import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

/**
 * Free-agent adds, waiver claims and trade proposals or acceptances open only after the league's
 * draft is COMPLETED. Every transaction route asks this one guard before it writes anything.
 */
export type TransactionWindow =
  { open: true } | { open: false; code: 'DRAFT_NOT_COMPLETE'; reason: string };

const DRAFT_NOT_COMPLETE: TransactionWindow = {
  open: false,
  code: 'DRAFT_NOT_COMPLETE',
  reason: 'Adds, waiver claims and trades open once the league draft is complete.',
};

export async function getTransactionWindow(
  leagueId: string,
  db: Pick<PrismaClient, 'draft'> = prisma
): Promise<TransactionWindow> {
  const draft = await db.draft.findUnique({ where: { leagueId }, select: { status: true } });
  return draft?.status === 'COMPLETED' ? { open: true } : DRAFT_NOT_COMPLETE;
}

export function transactionsClosedResponse(
  window: Extract<TransactionWindow, { open: false }>
): NextResponse {
  return NextResponse.json({ error: window.reason, code: window.code }, { status: 409 });
}
