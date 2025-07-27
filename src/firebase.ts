// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDCu0sqW0QkqK5FGu5wbmCEPKOLzZga89s",
  authDomain: "statly-4cbed.firebaseapp.com",
  projectId: "statly-4cbed",
  storageBucket: "statly-4cbed.firebasestorage.app",
  messagingSenderId: "357171402575",
  appId: "1:357171402575:web:ac36ddc35e54adcf3f573a",
  measurementId: "G-6VXMJ85NBS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };

// src/lib/firebaseHelpers.ts
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export const fetchPlayerStats = async () => {
  try {
    const snapshot = await getDocs(collection(db, "players"));
    const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("Fetched player stats:", players);
    return players;
  } catch (error) {
    console.error("Error fetching player stats:", error);
  }
};