import { db } from '../src/lib/firebaseClient';
import { doc, setDoc, Timestamp, collection, getDocs } from 'firebase/firestore';

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');

const DRAFT_CONFIG = {
  TIME_PER_PICK_SEC: 60,
  TOTAL_ROUNDS: 10,
  TEAM_COUNT: 12,
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

async function getTeamNames(): Promise<string[]> {
  if (isTest) {
    return TEST_TEAM_NAMES;
  }

  if (!db) {
    console.warn('Firebase database not initialized, using fallback team names');
    return TEST_TEAM_NAMES.slice(0, DRAFT_CONFIG.TEAM_COUNT);
  }

  try {
    const teamsSnapshot = await getDocs(collection(db!, 'teams'));
    const teamNames = teamsSnapshot.docs.map((d) => d.data().name as string).filter(Boolean);

    if (teamNames.length === 0) {
      throw new Error('No teams found in database');
    }

    return teamNames.slice(0, DRAFT_CONFIG.TEAM_COUNT);
  } catch (err) {
    console.warn(
      'Failed to load teams from database, using fallback names:',
      (err as Error).message
    );
    return Array.from({ length: DRAFT_CONFIG.TEAM_COUNT }, (_, i) => `Team ${i + 1}`);
  }
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

type RoomStatus = 'pending' | 'active' | 'completed';

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

async function seedRoomMeta(): Promise<void> {
  const teams = await getTeamNames();
  const shouldShuffle = process.argv.includes('--shuffle');

  const meta: RoomMeta = {
    timePerPickSec: DRAFT_CONFIG.TIME_PER_PICK_SEC,
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

  if (meta.draftOrder.length < 2) {
    throw new Error(`Need at least 2 teams, got ${meta.draftOrder.length}`);
  }

  const roomId = process.argv[2] || 'room1';

  if (!db) {
    throw new Error('Firebase database not initialized. Cannot create room metadata.');
  }

  const roomRef = doc(db!, 'rooms', roomId);

  try {
    await setDoc(roomRef, meta, { merge: true });
    console.log(`✅ Draft metadata added to ${roomId}`);
    console.log(`   Mode: ${isTest ? 'test' : 'production'}`);
    console.log(`   Teams: ${meta.draftOrder.length}`);
    console.log(`   Order: ${shouldShuffle ? 'shuffled' : 'original'}`);
    console.log(`   Draft order: ${meta.draftOrder.join(', ')}`);
  } catch (err) {
    console.error('Failed to seed room metadata:', (err as Error).message);
    process.exit(1);
  }
}

seedRoomMeta();
