import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { DRAFT_PICK_SECONDS_OPTIONS } from '@/lib/draftClock';
import { logger } from '@/lib/logger';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';
import { leagueDraftProvisioningService } from '@/server/draft/services/LeagueDraftProvisioningService';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
export const runtime = 'nodejs';

const CreateDraftSchema = z.object({
  name: z.string().optional(),
  draftType: z.enum(['snake', 'linear']).optional().default('snake'),
  timePerPick: z
    .number()
    .int()
    .refine(
      (value) =>
        DRAFT_PICK_SECONDS_OPTIONS.includes(value as (typeof DRAFT_PICK_SECONDS_OPTIONS)[number]),
      `Time per pick must be one of: ${DRAFT_PICK_SECONDS_OPTIONS.join(', ')} seconds`
    )
    .optional()
    .default(120),
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

    const overdueStart = await draftApplicationService.startDraftIfOverdue({ leagueId });
    if (overdueStart) {
      await draftRealtimePublisher.publishCommandResult(overdueStart);
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
    const provisioning = await leagueDraftProvisioningService.syncFromLeagueSettings(leagueId);

    if (provisioning.status === 'skipped') {
      const status =
        provisioning.reason === 'missing_draft_date' ||
        provisioning.reason === 'draft_order_incomplete'
          ? 400
          : provisioning.reason === 'existing_draft_locked'
            ? 409
            : 400;

      return NextResponse.json(
        {
          success: false,
          error:
            provisioning.reason === 'missing_draft_date'
              ? 'Set a draft date in league settings before creating the draft room'
              : provisioning.reason === 'draft_order_incomplete'
                ? 'Set and save a valid draft order before creating the draft room'
                : provisioning.reason === 'insufficient_members'
                  ? 'Need at least 4 members to create a draft room'
                  : provisioning.reason === 'draft_date_in_past'
                    ? 'Draft date must be in the future'
                    : 'Existing draft can no longer be rescheduled from league settings',
        },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: provisioning.draft?.id,
        draftId: provisioning.draft?.id,
        status: provisioning.draft?.status,
        startAt: provisioning.draft?.startAt,
        createdAt: provisioning.draft?.createdAt,
        message:
          provisioning.status === 'created'
            ? 'Draft room created from league settings'
            : 'Draft room updated from league settings',
      },
    });
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
