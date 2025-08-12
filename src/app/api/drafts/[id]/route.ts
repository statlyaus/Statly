import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get draft with all related data
    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        league: {
          include: {
            settings: true,
            members: {
              include: {
                user: true
              },
              orderBy: { joinedAt: 'asc' }
            }
          }
        },
        orders: {
          include: {
            member: {
              include: {
                user: true
              }
            }
          },
          orderBy: { slot: 'asc' }
        },
        picks: {
          include: {
            player: true,
            member: {
              include: {
                user: true
              }
            }
          },
          orderBy: { overall: 'asc' }
        }
      }
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    // Get available players (not picked yet)
    const pickedPlayerIds = draft.picks.map(pick => pick.playerId);
    const availablePlayers = await prisma.player.findMany({
      where: {
        id: {
          notIn: pickedPlayerIds
        },
        active: true
      },
      orderBy: [
        { position: 'asc' },
        { name: 'asc' }
      ],
      take: 100 // Limit for performance
    });

    const draftData = {
      id: draft.id,
      name: `${draft.league?.name || 'Draft'} - ${draft.status}`,
      leagueSize: draft.league?.members.length || 0,
      draftType: draft.league?.settings?.draftType || 'SNAKE',
      timePerPick: draft.league?.settings?.pickSeconds || 120,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      round: draft.round,
      direction: draft.direction,
      createdAt: draft.createdAt.toISOString(),
      startedAt: draft.startedAt?.toISOString(),
      completedAt: draft.completedAt?.toISOString(),
      participants: draft.orders.map(order => ({
        slot: order.slot,
        member: {
          id: order.member.id,
          userId: order.member.userId,
          displayName: order.member.user.displayName,
          email: order.member.user.email
        }
      })),
      players: availablePlayers.map(player => ({
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club
      })),
      picks: draft.picks.map(pick => ({
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        madeAt: pick.madeAt.toISOString(),
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          club: pick.player.club
        },
        member: {
          id: pick.member.id,
          displayName: pick.member.user.displayName
        }
      }))
    };
    
    logger.info('Draft retrieved successfully', {
      draftId: id,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks
    });

    return successResponse(draftData);
    
  } catch (error) {
    logger.error('Failed to retrieve draft', { 
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    });
    
    return errorResponse('Failed to retrieve draft', 500);
  }
}
