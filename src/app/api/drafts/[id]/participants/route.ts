import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/drafts/[id]/participants
// Returns the draft participants in draft order (slot -> member)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;

    if (!draftId || typeof draftId !== 'string') {
      return errorResponse('Invalid draft id', 400);
    }

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        orders: { orderBy: { slot: 'asc' } },
        league: {
          include: {
            members: {
              include: { user: { select: { id: true, displayName: true, email: true } } },
            },
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    // Build a lookup for members by id
    const memberById = new Map(
      draft.league.members.map((m) => [
        m.id,
        {
          id: m.id,
          userId: m.userId,
          displayName: m.user.displayName || m.user.email || 'Unknown',
          role: (m.role as 'OWNER' | 'MANAGER' | 'MEMBER') ?? 'MEMBER',
        },
      ])
    );

    const participants = draft.orders.map((o) => ({
      slot: o.slot,
      member: memberById.get(o.memberId) ?? {
        id: o.memberId,
        userId: 'unknown',
        displayName: 'Unknown',
        role: 'MEMBER' as const,
      },
    }));

    logger.info('Draft participants retrieved', {
      draftId,
      count: participants.length,
    });

    return successResponse({ participants });
  } catch (error) {
    logger.error('Failed to retrieve draft participants', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return errorResponse('Failed to retrieve draft participants', 500);
  }
}
