// Use the shared Firebase web client to access Firestore
// Use a relative path so the script can run outside the Next.js app
import { db } from '../src/lib/firebaseClient';
import { doc, updateDoc } from 'firebase/firestore';

type RoomStatus = 'pending' | 'active' | 'completed';

type RoomMeta = {
  timePerPickSec: number;
  currentPick: number;
  round: number;
  totalRounds: number;
  status: RoomStatus;
};

async function seedRoomMeta() {
  const roomId = 'room1';
  const roomRef = doc(db, 'rooms', roomId);

  const meta: RoomMeta = {
    timePerPickSec: 60,
    currentPick: 0,
    round: 1,
    totalRounds: 10,
    status: 'pending',
  };

  try {
    await updateDoc(roomRef, meta);
    console.log(`✅ Draft metadata added to ${roomId}`);
  } catch (err) {
    console.error(`❌ Failed to update ${roomId}`, err);
  }
}

seedRoomMeta();

