// API endpoint for league presets and format configurations

import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { LEAGUE_PRESETS } from '@/lib/scheduling';

export async function GET() {
  try {
    // Define playoff formats based on the scheduling library's capabilities
    const playoffFormats = {
      // Single-elimination formats by team count
      elimination: {
        2: {
          name: '2-Team Final',
          description: 'Direct head-to-head championship',
          teams: 2,
          rounds: 1,
          structure: 'Single elimination',
          examples: ['1 vs 2'],
        },
        4: {
          name: '4-Team Finals',
          description: 'Semi-finals and Grand Final',
          teams: 4,
          rounds: 2,
          structure: 'Single elimination',
          examples: ['1 vs 4, 2 vs 3', 'Winners to Grand Final'],
        },
        6: {
          name: '6-Team Finals (AFL Style)',
          description: 'Traditional AFL finals with byes for top 2',
          teams: 6,
          rounds: 3,
          structure: 'Single elimination with byes',
          examples: ['3 vs 6, 4 vs 5', '1 vs lowest, 2 vs highest', 'Grand Final'],
        },
        8: {
          name: '8-Team Finals',
          description: 'Full bracket elimination',
          teams: 8,
          rounds: 3,
          structure: 'Single elimination',
          examples: ['Quarter Finals (4 matches)', 'Semi Finals (2 matches)', 'Grand Final'],
        },
        10: {
          name: '10-Team Finals',
          description: 'Extended bracket with first-round byes',
          teams: 10,
          rounds: 4,
          structure: 'Single elimination with byes',
          examples: ['First Round (3 matches)', 'Quarter Finals', 'Semi Finals', 'Grand Final'],
        },
        12: {
          name: '12-Team Finals',
          description: 'Large bracket tournament',
          teams: 12,
          rounds: 4,
          structure: 'Single elimination with byes',
          examples: ['First Round (4 matches)', 'Quarter Finals', 'Semi Finals', 'Grand Final'],
        },
        16: {
          name: '16-Team Finals',
          description: 'Full power-of-2 bracket',
          teams: 16,
          rounds: 4,
          structure: 'Single elimination',
          examples: ['Round 1 (8 matches)', 'Quarter Finals', 'Semi Finals', 'Grand Final'],
        },
      },

      // Leg length options
      legFormats: {
        single: {
          name: 'Single Week',
          description: 'One match per playoff round',
          weeks: 1,
          advantages: ['Quick resolution', 'Less schedule impact'],
          disadvantages: ['High variance', 'Single bad performance eliminates'],
        },
        aggregate: {
          name: 'Two-Week Aggregate',
          description: 'Home and away legs, total score wins',
          weeks: 2,
          advantages: ['More fair', 'Reduces luck factor', 'Home/away balance'],
          disadvantages: ['Longer schedule', 'More complex scoring'],
        },
        bestOfThree: {
          name: 'Best of Three',
          description: 'Three-week series, first to win 2 advances',
          weeks: 3,
          advantages: ['Most fair', 'Exciting format', 'Comeback potential'],
          disadvantages: ['Longest format', 'Significant schedule impact'],
        },
      },

      // Reseeding options
      seedingFormats: {
        fixed: {
          name: 'Fixed Bracket',
          description: 'Bracket set at start, no reseeding between rounds',
          reseed: false,
          advantages: ['Predictable matchups', 'Easier to follow', 'Traditional format'],
          disadvantages: ['Unbalanced later rounds', 'Upsets can create easy paths'],
        },
        reseeded: {
          name: 'Reseeded Bracket',
          description: 'Highest remaining seed faces lowest each round',
          reseed: true,
          advantages: ['Always balanced matchups', 'Rewards regular season performance'],
          disadvantages: ['Unpredictable bracket', 'Complex to follow'],
        },
      },

      // Popular configurations
      popularConfigurations: {
        afl_classic: {
          name: 'AFL Classic Finals',
          description: 'Traditional 8-team single-week finals',
          teams: 8,
          legLengthWeeks: 1,
          reseedEachRound: false,
          weeksRequired: 3,
          rounds: ['Qualifying Finals', 'Semi Finals', 'Grand Final'],
        },
        afl_modern: {
          name: 'Modern AFL Finals',
          description: '6-team finals with top-2 byes',
          teams: 6,
          legLengthWeeks: 1,
          reseedEachRound: true,
          weeksRequired: 3,
          rounds: ['Elimination Finals', 'Semi Finals', 'Grand Final'],
        },
        championship_series: {
          name: 'Championship Series',
          description: '4-team two-week aggregate finals',
          teams: 4,
          legLengthWeeks: 2,
          reseedEachRound: false,
          weeksRequired: 4,
          rounds: ['Semi Finals (2 weeks)', 'Grand Final (2 weeks)'],
        },
        extended_playoffs: {
          name: 'Extended Playoffs',
          description: '12-team single-week bracket',
          teams: 12,
          legLengthWeeks: 1,
          reseedEachRound: true,
          weeksRequired: 4,
          rounds: ['First Round', 'Quarter Finals', 'Semi Finals', 'Grand Final'],
        },
      },

      // Validation constraints
      constraints: {
        minTeams: 2,
        maxTeams: 20, // Based on MAX_TEAMS constant
        minLegLength: 1,
        maxLegLength: 3,
        supportedTeamCounts: [2, 4, 6, 8, 10, 12, 16], // Common power-of-2 and AFL-style counts
        roundNames: {
          1: ['Grand Final'],
          2: ['Semi Finals', 'Grand Final'],
          3: ['Quarter Finals', 'Semi Finals', 'Grand Final'],
          4: ['First Round', 'Quarter Finals', 'Semi Finals', 'Grand Final'],
        },
      },
    };

    return NextResponse.json({
      presets: LEAGUE_PRESETS,
      playoffFormats,
    });
  } catch (error) {
    logger.error('Error fetching league presets', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
