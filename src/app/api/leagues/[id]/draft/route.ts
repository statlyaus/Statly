import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
export const runtime = 'nodejs';

const CreateDraftSchema = z.object({
  name: z.string().optional(),
  draftType: z.enum(['snake', 'linear']).optional().default('snake'),
  timePerPick: z.number().int().min(30).max(600).optional().default(120),
  scheduledTime: z.string().optional(),
  timeZone: z.string().optional(),
  enableReminders: z.boolean().optional(),
});

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  const { id: leagueId } = await params;
  try {
    if (leagueId === 'test-league-id') {
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league: { id: 'test-league-id', name: 'Test AFL Champions League' },
          message: 'Test league: no draft exists yet',
        },
      });
    }

    const summary = await leagueApplicationService.getLeagueDraftSummary(leagueId);
    if (!summary) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }

    if (!summary.draft) {
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league: summary.league,
          message: 'No draft found for this league. Use the Draft tab to set up a draft.',
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        hasDraft: true,
        draftId: summary.draft.id,
        league: summary.league,
        status: summary.draft.status,
        startAt: summary.draft.startAt,
        createdAt: summary.draft.createdAt,
        draft: summary.draft,
      },
    });
  } catch (error) {
    logger.error(
      'Error fetching league draft',
      error instanceof Error ? error : new Error(String(error)),
      { leagueId }
    );
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league draft' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  const { id: leagueId } = await params;
  try {
    const rawBody = (await req.json().catch(() => null)) as unknown;
    const parsed = CreateDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Draft creation validation failed', {
        issues: parsed.error.flatten().fieldErrors,
        leagueId,
      });
      return NextResponse.json(
        { success: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const body = parsed.data;

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        members: {
          include: {
            user: true,
          },
          orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
        },
        drafts: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }

    if (league.drafts.length > 0) {
      const existingDraft = league.drafts[0];
      return NextResponse.json(
        {
          success: true,
          data: {
            message: 'Draft already exists',
            draftId: existingDraft.id,
          },
        },
        { status: 200 }
      );
    }

    const participants = league.members.map((member, index) => ({
      userId: member.userId,
      memberId: member.id,
      displayName:
        member.teamName || member.user.displayName || member.user.email || `Team ${index + 1}`,
      draftOrder: member.draftSlot ?? index + 1,
      isOwner: member.userId === league.ownerId,
    }));

    const draftPayload = {
      name: body.name || `${league.name} Draft`,
      leagueId,
      leagueSize: league.members.length,
      draftType: body.draftType,
      timePerPick: body.timePerPick,
      scheduledTime: body.scheduledTime,
      timeZone: body.timeZone || league.settings.timeZone,
      enableReminders: body.enableReminders ?? true,
      leagueData: {
        name: league.name,
        maxTeams: league.settings.maxTeams,
        categories: [],
        ownerId: league.ownerId,
      },
      participants,
    };

    const forwarded = await fetch(new URL('/api/drafts', req.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: req.headers.get('cookie') || '',
        authorization: req.headers.get('authorization') || '',
        'x-auth-user': req.headers.get('x-auth-user') || '',
      },
      body: JSON.stringify(draftPayload),
      cache: 'no-store',
    });

    const json = (await forwarded.json().catch(() => null)) as unknown;
    return NextResponse.json(json, { status: forwarded.status });
  } catch (error) {
    logger.error(
      'Error creating league draft',
      error instanceof Error ? error : new Error(String(error)),
      { leagueId }
    );
    return NextResponse.json(
      { success: false, error: 'Failed to create league draft' },
      { status: 500 }
    );
  }
}
