#!/usr/bin/env node
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON 
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8'))
    : require('../statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

interface ValidationResult {
  matchUid: string;
  success: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalPlayers: number;
    scoreValidation: {
      calculated: { home: number; away: number };
      expected: { home: number; away: number };
      difference: { home: number; away: number };
    };
    disposalsValidation: {
      validPlayers: number;
      invalidPlayers: number;
      validationRate: number;
    };
  };
}

/**
 * Validate player statistics for a given match
 */
async function validateMatch(matchUid: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    matchUid,
    success: true,
    errors: [],
    warnings: [],
    stats: {
      totalPlayers: 0,
      scoreValidation: {
        calculated: { home: 0, away: 0 },
        expected: { home: 0, away: 0 },
        difference: { home: 0, away: 0 }
      },
      disposalsValidation: {
        validPlayers: 0,
        invalidPlayers: 0,
        validationRate: 0
      }
    }
  };

  try {
    console.log(`🔍 Validating match: ${matchUid}`);

    // Get match document
    const matchDoc = await db.collection('matches').doc(matchUid).get();
    if (!matchDoc.exists) {
      result.errors.push(`Match document not found: ${matchUid}`);
      result.success = false;
      return result;
    }

    const matchData = matchDoc.data();
    const expectedScores = matchData?.scores || {};

    // Get player stats for this match
    const playerStatsSnapshot = await db.collection('player_match_stats')
      .where('match_uid', '==', matchUid)
      .get();

    if (playerStatsSnapshot.empty) {
      result.errors.push(`No player statistics found for match: ${matchUid}`);
      result.success = false;
      return result;
    }

    result.stats.totalPlayers = playerStatsSnapshot.size;
    console.log(`📊 Found ${result.stats.totalPlayers} player records`);

    // Group players by team and calculate scores
    const teamStats: Record<string, { goals: number; behinds: number; players: any[] }> = {};
    let validDisposalsCount = 0;
    let invalidDisposalsCount = 0;

    playerStatsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const stats = data.stats || {};
      const team = data.team || data.team_abbr || 'Unknown';

      // Initialize team if not exists
      if (!teamStats[team]) {
        teamStats[team] = { goals: 0, behinds: 0, players: [] };
      }

      // Sum goals and behinds
      const goals = parseInt(stats.goals) || 0;
      const behinds = parseInt(stats.behinds) || 0;
      teamStats[team].goals += goals;
      teamStats[team].behinds += behinds;
      teamStats[team].players.push(data);

      // Validate disposals = kicks + handballs
      const disposals = parseInt(stats.disposals) || 0;
      const kicks = parseInt(stats.kicks) || 0;
      const handballs = parseInt(stats.handballs) || 0;
      const calculatedDisposals = kicks + handballs;

      if (disposals > 0 && calculatedDisposals > 0) {
        const difference = Math.abs(disposals - calculatedDisposals);
        const tolerance = Math.max(1, Math.round(disposals * 0.05)); // 5% tolerance

        if (difference <= tolerance) {
          validDisposalsCount++;
        } else {
          invalidDisposalsCount++;
          result.warnings.push(
            `Player ${data.player_name} (${team}): disposals=${disposals}, kicks+handballs=${calculatedDisposals}, diff=${difference}`
          );
        }
      }
    });

    // Calculate validation rates
    const totalValidatedPlayers = validDisposalsCount + invalidDisposalsCount;
    result.stats.disposalsValidation = {
      validPlayers: validDisposalsCount,
      invalidPlayers: invalidDisposalsCount,
      validationRate: totalValidatedPlayers > 0 ? (validDisposalsCount / totalValidatedPlayers) : 0
    };

    console.log(`⚖️  Disposals validation: ${validDisposalsCount}/${totalValidatedPlayers} players (${(result.stats.disposalsValidation.validationRate * 100).toFixed(1)}%)`);

    // Validate disposals rate (must be ≥95%)
    if (result.stats.disposalsValidation.validationRate < 0.95) {
      result.errors.push(
        `Disposals validation rate too low: ${(result.stats.disposalsValidation.validationRate * 100).toFixed(1)}% (required: ≥95%)`
      );
      result.success = false;
    }

    // Calculate team scores (goals*6 + behinds)
    const teams = Object.keys(teamStats);
    if (teams.length !== 2) {
      result.warnings.push(`Expected 2 teams, found ${teams.length}: ${teams.join(', ')}`);
    }

    const [homeTeam, awayTeam] = teams;
    if (homeTeam && awayTeam) {
      const homeScore = teamStats[homeTeam].goals * 6 + teamStats[homeTeam].behinds;
      const awayScore = teamStats[awayTeam].goals * 6 + teamStats[awayTeam].behinds;

      result.stats.scoreValidation.calculated = { home: homeScore, away: awayScore };
      result.stats.scoreValidation.expected = {
        home: expectedScores.home || 0,
        away: expectedScores.away || 0
      };

      result.stats.scoreValidation.difference = {
        home: Math.abs(homeScore - (expectedScores.home || 0)),
        away: Math.abs(awayScore - (expectedScores.away || 0))
      };

      console.log(`🏆 Score validation:`);
      console.log(`   ${homeTeam}: calculated=${homeScore}, expected=${expectedScores.home || 'N/A'}, diff=${result.stats.scoreValidation.difference.home}`);
      console.log(`   ${awayTeam}: calculated=${awayScore}, expected=${expectedScores.away || 'N/A'}, diff=${result.stats.scoreValidation.difference.away}`);

      // Check score differences (allow up to 6 points difference for timing)
      const maxScoreDifference = 12; // 2 goals tolerance
      if (result.stats.scoreValidation.difference.home > maxScoreDifference) {
        result.errors.push(
          `Home team score mismatch: calculated=${homeScore}, expected=${expectedScores.home}, diff=${result.stats.scoreValidation.difference.home}`
        );
        result.success = false;
      }
      if (result.stats.scoreValidation.difference.away > maxScoreDifference) {
        result.errors.push(
          `Away team score mismatch: calculated=${awayScore}, expected=${expectedScores.away}, diff=${result.stats.scoreValidation.difference.away}`
        );
        result.success = false;
      }
    }

  } catch (error) {
    result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    result.success = false;
  }

  return result;
}

/**
 * Run validation for multiple matches
 */
async function runValidation(matchUids: string[]): Promise<void> {
  console.log(`🚀 Starting validation for ${matchUids.length} matches...`);
  
  const results: ValidationResult[] = [];
  let successCount = 0;

  for (const matchUid of matchUids) {
    const result = await validateMatch(matchUid);
    results.push(result);

    if (result.success) {
      console.log(`✅ ${matchUid}: PASSED`);
      successCount++;
    } else {
      console.log(`❌ ${matchUid}: FAILED`);
      result.errors.forEach(error => console.log(`   Error: ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log(`⚠️  ${matchUid}: ${result.warnings.length} warnings`);
      result.warnings.slice(0, 3).forEach(warning => console.log(`   Warning: ${warning}`));
      if (result.warnings.length > 3) {
        console.log(`   ... and ${result.warnings.length - 3} more warnings`);
      }
    }
  }

  // Summary
  console.log(`\n📋 Validation Summary:`);
  console.log(`   Total matches: ${results.length}`);
  console.log(`   Passed: ${successCount}`);
  console.log(`   Failed: ${results.length - successCount}`);

  if (successCount < results.length) {
    console.log(`\n❌ Validation failed: ${results.length - successCount} matches have issues`);
    process.exit(1);
  } else {
    console.log(`\n✅ All validations passed!`);
    process.exit(0);
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node validateMatchData.js <matchUid1> [matchUid2] ...');
    console.log('Example: node validateMatchData.js 2025-R18-ADE-COL 2025-R18-GEE-HAW');
    process.exit(1);
  }

  await runValidation(args);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { validateMatch, runValidation };
