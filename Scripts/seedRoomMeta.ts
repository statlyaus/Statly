import { Timestamp } from 'firebase-admin/firestore';

import { DRAFT_DEFAULTS, FIREBASE_COLLECTIONS } from './constants';
import type { RoomStatus } from './constants';
import { initFirestore, logProgress } from './utils';

// Types
interface RoomMeta {
  timePerPickSec: number;
  currentPick: number;
  round: number;
  totalRounds: number;
  status: RoomStatus;
  startTime: Timestamp | null;
  createdAt: Timestamp;
  draftOrder: string[];
  pickHistory: string[];
  currentTeamIndex: number;
}

// Configuration
const db = initFirestore();

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');

const DRAFT_CONFIG = {
  TIME_PER_PICK_SEC: DRAFT_DEFAULTS.TIME_PER_PICK_SEC,
  TOTAL_ROUNDS: DRAFT_DEFAULTS.TOTAL_ROUNDS,
  TEAM_COUNT: DRAFT_DEFAULTS.DEFAULT_TEAM_COUNT,
  MIN_TEAMS: DRAFT_DEFAULTS.MIN_TEAMS,
  MAX_TEAMS: DRAFT_DEFAULTS.MAX_TEAMS,
  AVAILABLE_PICK_TIMES: [30, 45, 60, 90, 120] as const,
} as const;

const TEST_TEAM_NAMES = [
  'Team A',
  'Team B',
  'Team C',
  'Team D',
  'Team E',
  'Team F',
  'Team G',
  'Team H',
  'Team I',
  'Team J',
  'Team K',
  'Team L',
];

/**
 * Gets team names for the draft
 * @returns Array of team names
 */
async function getTeamNames(): Promise<string[]> {
  if (isTest) {
    return TEST_TEAM_NAMES;
  }

  try {
    const teamsSnapshot = await db.collection(FIREBASE_COLLECTIONS.TEAMS).get();
    const teamNames = teamsSnapshot.docs.map((d) => d.data().name as string).filter(Boolean);

    if (teamNames.length === 0) {
      throw new Error('No teams found in database');
    }

    return teamNames.slice(0, DRAFT_CONFIG.TEAM_COUNT);
  } catch (error) {
    logProgress('Failed to load teams from database, using fallback names', 'warning');
    console.warn('Error details:', error instanceof Error ? error.message : String(error));
    return Array.from({ length: DRAFT_CONFIG.TEAM_COUNT }, (_, i) => `Team ${i + 1}`);
  }
}

/**
 * Shuffles an array using Fisher-Yates algorithm
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Parses and validates the time per pick argument
 * @param args - Command line arguments
 * @returns Time per pick in seconds
 */
function parseTimePerPick(args: string[]): number {
  const timeArg = args.find((arg) => arg.startsWith('--time='));

  if (!timeArg) {
    return DRAFT_CONFIG.TIME_PER_PICK_SEC;
  }

  const timeValue = parseInt(timeArg.split('=')[1]);

  if (isNaN(timeValue) || !DRAFT_CONFIG.AVAILABLE_PICK_TIMES.includes(timeValue as any)) {
    logProgress(
      `Invalid time per pick: ${timeValue}. Available options: ${DRAFT_CONFIG.AVAILABLE_PICK_TIMES.join(', ')} seconds`,
      'error'
    );
    process.exit(1);
  }

  return timeValue;
}

/**
 * Seeds room metadata for draft initialization
 * @param roomId - The room identifier
 */

async function seedRoomMeta(): Promise<void> {
  // Validate room ID argument
  const roomId = process.argv[2];
  if (!roomId) {
    logProgress('Room ID is required.', 'error');
    logProgress(
      'Usage: npm run seed-room-meta <roomId> [--shuffle] [--test] [--time=30|45|60|90|120]',
      'info'
    );
    logProgress(
      `Available time options: ${DRAFT_CONFIG.AVAILABLE_PICK_TIMES.join(', ')} seconds`,
      'info'
    );
    process.exit(1);
  }

  const teams = await getTeamNames();
  const shouldShuffle = process.argv.includes('--shuffle');
  const timePerPick = parseTimePerPick(process.argv);

  // Validate team count
  if (teams.length < DRAFT_CONFIG.MIN_TEAMS) {
    throw new Error(`Need at least ${DRAFT_CONFIG.MIN_TEAMS} teams, got ${teams.length}`);
  }

  if (teams.length > DRAFT_CONFIG.MAX_TEAMS) {
    logProgress(
      `Too many teams (${teams.length}), limiting to ${DRAFT_CONFIG.MAX_TEAMS}`,
      'warning'
    );
    teams.splice(DRAFT_CONFIG.MAX_TEAMS);
  }

  const meta: RoomMeta = {
    timePerPickSec: timePerPick,
    currentPick: 0,
    round: 1,
    totalRounds: DRAFT_CONFIG.TOTAL_ROUNDS,
    status: 'pending',
    startTime: null,
    createdAt: Timestamp.fromDate(new Date()),
    draftOrder: shouldShuffle ? shuffleArray(teams) : teams,
    pickHistory: [],
    currentTeamIndex: 0,
  };

  try {
    await db.collection(FIREBASE_COLLECTIONS.ROOMS).doc(roomId).set(meta, { merge: true });
    logProgress(`Draft metadata added to ${roomId}`, 'success');
    logProgress(`Mode: ${isTest ? 'test' : 'production'}`, 'info');
    logProgress(`Teams: ${meta.draftOrder.length}`, 'info');
    logProgress(`Time per pick: ${timePerPick} seconds`, 'info');
    logProgress(`Order: ${shouldShuffle ? 'shuffled' : 'original'}`, 'info');
    logProgress(`Draft order: ${meta.draftOrder.join(', ')}`, 'info');
  } catch (err) {
    logProgress(`Failed to seed room metadata: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

// Main execution
async function main(): Promise<void> {
  try {
    await seedRoomMeta();
  } catch (err) {
    logProgress(`Script failed: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main();
}
