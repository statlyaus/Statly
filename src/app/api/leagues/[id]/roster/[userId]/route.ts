import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Ensure roster tables exist
    await ensureRosterTables();

    // Get user's member record in this league
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    // Get league settings to check captain system
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
      },
    });

    if (!league) {
      return errorResponse('League not found', 404);
    }

    // Try to get existing roster using raw SQL
    const rosterRows = await prisma.$queryRaw`
      SELECT * FROM LeagueRoster 
      WHERE leagueId = ${leagueId} AND memberId = ${member.id}
      LIMIT 1
    ` as Record<string, unknown>[];
    
    let roster = rosterRows[0];

    // If no roster exists, check if there are draft picks to initialize from
    if (!roster) {
      const draft = await prisma.draft.findFirst({
        where: { leagueId },
        include: {
          picks: {
            where: { memberId: member.id },
            include: { player: true },
            orderBy: { overall: 'asc' },
          },
        },
      });

      let playerIds: string[] = [];
      if (draft && draft.picks.length > 0) {
        playerIds = draft.picks.map(pick => pick.playerId);
        
        // Create initial roster from draft picks using raw SQL
        await prisma.$executeRaw`
          INSERT INTO LeagueRoster (id, leagueId, memberId, playerIds, createdAt, updatedAt)
          VALUES (${crypto.randomUUID()}, ${leagueId}, ${member.id}, ${JSON.stringify(playerIds)}, datetime('now'), datetime('now'))
        `;
        
        // Re-fetch the created roster
        const newRosterRows = await prisma.$queryRaw`
          SELECT * FROM LeagueRoster 
          WHERE leagueId = ${leagueId} AND memberId = ${member.id}
          LIMIT 1
        ` as Record<string, unknown>[];
        
        roster = newRosterRows[0];

        logger.info('Created roster from draft picks', {
          leagueId,
          memberId: member.id,
          playerCount: playerIds.length,
        });
      }
    }

    // Get player details
    const playerIds = roster ? JSON.parse(String(roster.playerIds)) : [];
    const players = await prisma.player.findMany({
      where: {
        id: { in: playerIds },
      },
    });

    // Format response with enhanced player data
    const playersWithStats = players.map(player => {
      // Generate realistic fantasy statistics based on position
      const baseFantasyScore = player.position === 'MID' ? 90 :
                              player.position === 'FWD' ? 80 :
                              player.position === 'DEF' ? 75 :
                              player.position === 'RUC' ? 85 : 75;
      
      const variance = Math.random() * 20 - 10;
      const averageScore = Math.round(baseFantasyScore + variance);
      const lastGameScore = Math.round(averageScore + (Math.random() * 30 - 15));
      const projectedScore = Math.round(averageScore + (Math.random() * 20 - 10));

      // Generate realistic pricing
      const basePrice = player.position === 'MID' ? 650000 :
                       player.position === 'FWD' ? 600000 :
                       player.position === 'DEF' ? 550000 :
                       player.position === 'RUC' ? 580000 : 500000;
      
      const priceVariance = Math.random() * 200000 - 100000;
      const price = Math.round(basePrice + priceVariance);

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.club,
        price,
        averageScore,
        lastGameScore,
        projectedScore,
        form: [
          lastGameScore,
          Math.round(averageScore + (Math.random() * 20 - 10)),
          Math.round(averageScore + (Math.random() * 20 - 10)),
          Math.round(averageScore + (Math.random() * 20 - 10)),
          Math.round(averageScore + (Math.random() * 20 - 10)),
        ],
        isCaptain: roster?.captainId === player.id,
        isViceCaptain: roster?.viceCaptainId === player.id,
      };
    });

    const response = {
      roster: {
        id: roster?.id || null,
        leagueId,
        memberId: member.id,
        teamName: member.teamName,
        players: playersWithStats,
        captainId: roster?.captainId || null,
        viceCaptainId: roster?.viceCaptainId || null,
        benchOrder: roster?.benchOrder ? JSON.parse(String(roster.benchOrder)) : [],
        totalValue: playersWithStats.reduce((sum, p) => sum + p.price, 0),
        averageScore: Math.round(playersWithStats.reduce((sum, p) => sum + p.averageScore, 0) / playersWithStats.length || 0),
        updatedAt: roster?.updatedAt || new Date(),
      },
      leagueSettings: {
        enableCaptainSystem: true, // Temporarily always enabled
        captainMultiplier: 2.0,
        viceCaptainMultiplier: 1.5,
      },
    };

    return successResponse(response);

  } catch (error) {
    logger.error('Failed to get league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to retrieve roster', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;
    const body = await request.json();

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Ensure roster tables exist
    await ensureRosterTables();

    // Get user's member record
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    // Get league settings
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true },
    });

    if (!league) {
      return errorResponse('League not found', 404);
    }

    // Validate captain/vice-captain if captain system is enabled
    if (league.settings) { // Simplified check for now
      if (body.captainId && body.viceCaptainId && body.captainId === body.viceCaptainId) {
        return errorResponse('Captain and vice-captain cannot be the same player', 400);
      }
    }

    // Update or create roster using raw SQL
    // First check if roster exists
    const existingRosterRows = await prisma.$queryRaw`
      SELECT * FROM LeagueRoster 
      WHERE leagueId = ${leagueId} AND memberId = ${member.id}
      LIMIT 1
    ` as Record<string, unknown>[];
    
    let roster: Record<string, unknown>;
    
    if (existingRosterRows.length > 0) {
      // Update existing roster
      await prisma.$executeRaw`
        UPDATE LeagueRoster 
        SET playerIds = ${body.playerIds ? JSON.stringify(body.playerIds) : existingRosterRows[0].playerIds},
            captainId = ${body.captainId || existingRosterRows[0].captainId},
            viceCaptainId = ${body.viceCaptainId || existingRosterRows[0].viceCaptainId},
            benchOrder = ${body.benchOrder ? JSON.stringify(body.benchOrder) : existingRosterRows[0].benchOrder},
            updatedAt = datetime('now')
        WHERE leagueId = ${leagueId} AND memberId = ${member.id}
      `;
      
      // Get updated roster
      const updatedRosterRows = await prisma.$queryRaw`
        SELECT * FROM LeagueRoster 
        WHERE leagueId = ${leagueId} AND memberId = ${member.id}
        LIMIT 1
      ` as Record<string, unknown>[];
      
      roster = updatedRosterRows[0];
    } else {
      // Create new roster
      const rosterId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO LeagueRoster (id, leagueId, memberId, playerIds, captainId, viceCaptainId, benchOrder, createdAt, updatedAt)
        VALUES (${rosterId}, ${leagueId}, ${member.id}, ${JSON.stringify(body.playerIds || [])}, ${body.captainId}, ${body.viceCaptainId}, ${body.benchOrder ? JSON.stringify(body.benchOrder) : null}, datetime('now'), datetime('now'))
      `;
      
      // Get created roster
      const newRosterRows = await prisma.$queryRaw`
        SELECT * FROM LeagueRoster 
        WHERE id = ${rosterId}
        LIMIT 1
      ` as Record<string, unknown>[];
      
      roster = newRosterRows[0];
    }

    logger.info('Updated league roster', {
      leagueId,
      memberId: member.id,
      rosterId: roster.id,
    });

    return successResponse({
      roster: {
        id: roster.id,
        leagueId: roster.leagueId,
        memberId: roster.memberId,
        captainId: roster.captainId,
        viceCaptainId: roster.viceCaptainId,
        benchOrder: roster.benchOrder ? JSON.parse(String(roster.benchOrder)) : [],
        updatedAt: roster.updatedAt,
      },
    });

  } catch (error) {
    logger.error('Failed to update league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update roster', 500);
  }
}
