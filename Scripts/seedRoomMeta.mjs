import { db } from "../src/firebase.js";
import { doc, setDoc, Timestamp, collection, getDocs } from "firebase/firestore";

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');

const DRAFT_CONFIG = {
  TIME_PER_PICK_SEC: 60,
  TOTAL_ROUNDS: 10,
  TEAM_COUNT: 12
};

const getTeamNames = async () => {
  if (isTest) {
    return [
      "Team A", "Team B", "Team C", "Team D",
      "Team E", "Team F", "Team G", "Team H",
      "Team I", "Team J", "Team K", "Team L"
    ];
  }
  
  // Load real team names from your database
  try {
    const teamsSnapshot = await getDocs(collection(db, 'teams'));
    const teamNames = teamsSnapshot.docs.map(doc => doc.data().name).filter(Boolean);
    
    if (teamNames.length === 0) {
      throw new Error("No teams found in database");
    }
    
    return teamNames.slice(0, DRAFT_CONFIG.TEAM_COUNT); // Ensure we don't exceed expected count
  } catch (err) {
    console.warn("Failed to load teams from database, using fallback names:", err.message);
    return Array.from({ length: DRAFT_CONFIG.TEAM_COUNT }, (_, i) => `Team ${i + 1}`);
  }
};

// Shuffle array for random draft order
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

(async () => {
  const teams = await getTeamNames();
  const shouldShuffle = process.argv.includes('--shuffle');
  
  const meta = {
    timePerPickSec: DRAFT_CONFIG.TIME_PER_PICK_SEC,
    currentPick: 0,
    round: 1,
    totalRounds: DRAFT_CONFIG.TOTAL_ROUNDS,
    status: "pending", // Start as pending, can be activated later
    startTime: null, // Set when draft actually starts
    createdAt: Timestamp.fromDate(new Date()),
    draftOrder: shouldShuffle ? shuffleArray(teams) : teams,
    pickHistory: [], // Track completed picks
    currentTeamIndex: 0, // Which team's turn it is
  };

  // Validation
  if (meta.draftOrder.length < 2) {
    throw new Error(`Need at least 2 teams, got ${meta.draftOrder.length}`);
  }

  const roomId = process.argv[2] || "room1";
  const roomRef = doc(db, "rooms", roomId);

  try {
    await setDoc(roomRef, meta, { merge: true });
    console.log(`✅ Draft metadata added to ${roomId}`);
    console.log(`   Mode: ${isTest ? 'test' : 'production'}`);
    console.log(`   Teams: ${meta.draftOrder.length}`);
    console.log(`   Order: ${shouldShuffle ? 'shuffled' : 'original'}`);
    console.log(`   Draft order: ${meta.draftOrder.join(', ')}`);
  } catch (err) {
    console.error("Failed to seed room metadata:", err.message || err);
    process.exit(1);
  }
})();