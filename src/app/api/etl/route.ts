// API routes for specific ETL data endpoints
// Place this in src/app/api/etl/route.ts

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getMatchPlayerStats,
  getPlayerProfile,
  getPlayerRecentStats,
  getTeamCurrentStats,
  getRoundMatches,
} from '@/lib/etlIntegration';

// GET /api/etl?type=match&matchUid=xxx
// GET /api/etl?type=player&playerUid=xxx&limit=10
// GET /api/etl?type=team&team=xxx&season=2025
// GET /api/etl?type=round&season=2025&round=1
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (!type) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required parameter: type',
          validTypes: ['match', 'player', 'team', 'round'],
        },
        { status: 400 }
      );
    }

    switch (type) {
      case 'match': {
        const matchUid = searchParams.get('matchUid');
        if (!matchUid) {
          return NextResponse.json(
            {
              success: false,
              error: 'Missing required parameter: matchUid',
            },
            { status: 400 }
          );
        }

        const playerStats = await getMatchPlayerStats(matchUid);
        return NextResponse.json({
          success: true,
          data: {
            matchUid,
            playerStats,
            totalPlayers: playerStats.length,
          },
        });
      }

      case 'player': {
        const playerUid = searchParams.get('playerUid');
        if (!playerUid) {
          return NextResponse.json(
            {
              success: false,
              error: 'Missing required parameter: playerUid',
            },
            { status: 400 }
          );
        }

        const limit = parseInt(searchParams.get('limit') || '10');
        const [profile, recentStats] = await Promise.all([
          getPlayerProfile(playerUid),
          getPlayerRecentStats(playerUid, limit),
        ]);

        return NextResponse.json({
          success: true,
          data: {
            playerUid,
            profile,
            recentStats,
            gamesPlayed: recentStats.length,
          },
        });
      }

      case 'team': {
        const team = searchParams.get('team');
        if (!team) {
          return NextResponse.json(
            {
              success: false,
              error: 'Missing required parameter: team',
            },
            { status: 400 }
          );
        }

        const season = searchParams.get('season')
          ? parseInt(searchParams.get('season')!)
          : undefined;
        const currentStats = await getTeamCurrentStats(team, season);

        return NextResponse.json({
          success: true,
          data: {
            team,
            season: season || new Date().getFullYear(),
            playerStats: currentStats,
            totalPlayers: currentStats.length,
          },
        });
      }

      case 'round': {
        const season = searchParams.get('season');
        const round = searchParams.get('round');

        if (!season || !round) {
          return NextResponse.json(
            {
              success: false,
              error: 'Missing required parameters: season and round',
            },
            { status: 400 }
          );
        }

        const matches = await getRoundMatches(parseInt(season), parseInt(round));

        return NextResponse.json({
          success: true,
          data: {
            season: parseInt(season),
            round: parseInt(round),
            matches,
            totalMatches: matches.length,
          },
        });
      }

      default:
        return NextResponse.json(
          {
            success: false,
            error: `Invalid type: ${type}`,
            validTypes: ['match', 'player', 'team', 'round'],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error in ETL API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
