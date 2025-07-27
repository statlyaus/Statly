import { db } from "../src/firebase.js";
import { doc, setDoc } from "firebase/firestore";

(async () => {
  const meta = {
    timePerPickSec: 60,
    currentPick: 0,
    round: 1,
    totalRounds: 10,
    status: "in-progress",
    startTime: Date.now(),
    draftOrder: [
      "Team A", "Team B", "Team C", "Team D",
      "Team E", "Team F", "Team G", "Team H",
      "Team I", "Team J", "Team K", "Team L"
    ],
  };

  const roomRef = doc(db, "rooms", "room1");

  try {
    await setDoc(roomRef, meta, { merge: true });
    console.log("✅ Draft metadata added to room1");
  } catch (err) {
    console.error("❌ Failed to update room1", err);
  }
})();