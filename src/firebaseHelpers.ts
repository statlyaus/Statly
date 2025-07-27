

import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export const fetchPlayerStats = async () => {
  try {
    const snapshot = await getDocs(collection(db, "players"));
    const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("Fetched players:", players);
    return players;
  } catch (error) {
    console.error("Error fetching player stats:", error);
    return [];
  }
};