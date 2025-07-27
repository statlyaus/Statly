

import { db } from "../src/firebase";
import { doc, updateDoc } from "firebase/firestore";

const meta = {
  timePerPickSec: 60,
  currentPick: 0,
  round: 1,
  totalRounds: 10,
  status: "pending"
};

async function seedRoomMeta() {
  const roomRef = doc(db, "rooms", "room1");

  try {
    await updateDoc(roomRef, meta);
    console.log("✅ Draft metadata added to room1");
  } catch (err) {
    console.error("❌ Failed to update room1", err);
  }
}

seedRoomMeta();