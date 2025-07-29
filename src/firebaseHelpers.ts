import { collection, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
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

// Save user's team lineup to Firestore
export const saveUserTeam = async (uid: string, lineup: any, bench: any, budget: number) => {
  try {
    await setDoc(doc(db, "users", uid), {
      lineup,
      bench,
      budget,
    }, { merge: true });
  } catch (error) {
    console.error("Error saving user team:", error);
  }
};

// Load user's team lineup from Firestore
export const loadUserTeam = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return {
        lineup: data.lineup || { DEF: [], MID: [], RUC: [], FWD: [] },
        bench: data.bench || [],
        budget: typeof data.budget === "number" ? data.budget : 4000000,
      };
    }
  } catch (error) {
    console.error("Error loading user team:", error);
  }
  return {
    lineup: { DEF: [], MID: [], RUC: [], FWD: [] },
    bench: [],
    budget: 4000000,
  };
};

// Save user's trade proposals to Firestore
export const saveUserTrades = async (uid: string, trades: any[]) => {
  try {
    await setDoc(doc(db, "users", uid), { trades }, { merge: true });
  } catch (error) {
    console.error("Error saving user trades:", error);
  }
};

// Load user's trade proposals from Firestore
export const loadUserTrades = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.trades || [];
    }
  } catch (error) {
    console.error("Error loading user trades:", error);
  }
  return [];
};

// Save user's watchlist to Firestore
export const saveUserWatchlist = async (uid: string, watchlist: string[]) => {
  try {
    await setDoc(doc(db, "users", uid), { watchlist }, { merge: true });
  } catch (error) {
    console.error("Error saving user watchlist:", error);
  }
};

// Load user's watchlist from Firestore
export const loadUserWatchlist = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.watchlist || [];
    }
  } catch (error) {
    console.error("Error loading user watchlist:", error);
  }
  return [];
};

// Save user settings/preferences (e.g., theme, notifications)
export const saveUserSettings = async (uid: string, settings: Record<string, any>) => {
  try {
    await setDoc(doc(db, "users", uid), { settings }, { merge: true });
  } catch (error) {
    console.error("Error saving user settings:", error);
  }
};

// Load user settings/preferences
export const loadUserSettings = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.settings || {};
    }
  } catch (error) {
    console.error("Error loading user settings:", error);
  }
  return {};
};

// Save player tags/notes (per user)
export const saveUserPlayerNotes = async (uid: string, playerNotes: Record<string, string>, playerTags: Record<string, string>) => {
  try {
    await setDoc(doc(db, "users", uid), { playerNotes, playerTags }, { merge: true });
  } catch (error) {
    console.error("Error saving player notes/tags:", error);
  }
};

// Load player tags/notes (per user)
export const loadUserPlayerNotes = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return {
        playerNotes: data.playerNotes || {},
        playerTags: data.playerTags || {},
      };
    }
  } catch (error) {
    console.error("Error loading player notes/tags:", error);
  }
  return { playerNotes: {}, playerTags: {} };
};

// Save league/join requests for a user
export const saveUserLeagueRequests = async (uid: string, leagueRequests: any[]) => {
  try {
    await setDoc(doc(db, "users", uid), { leagueRequests }, { merge: true });
  } catch (error) {
    console.error("Error saving league requests:", error);
  }
};

// Load league/join requests for a user
export const loadUserLeagueRequests = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.leagueRequests || [];
    }
  } catch (error) {
    console.error("Error loading league requests:", error);
  }
  return [];
};

// Update the status of a user's league join request (admin action)
export const updateLeagueRequestStatus = async (
  uid: string,
  leagueId: string,
  status: "Approved" | "Rejected"
) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      const leagueRequests = Array.isArray(data.leagueRequests) ? data.leagueRequests : [];
      const updated = leagueRequests.map((req: any) =>
        req.leagueId === leagueId ? { ...req, status } : req
      );
      await setDoc(doc(db, "users", uid), { leagueRequests: updated }, { merge: true });
    }
  } catch (error) {
    console.error("Error updating league request status:", error);
  }
};

// Get all users' league requests (for commissioner dashboard)
export const getAllLeagueRequests = async () => {
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const requests: Array<{ uid: string; leagueRequests: any[] }> = [];
    usersSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (Array.isArray(data.leagueRequests) && data.leagueRequests.length > 0) {
        requests.push({ uid: docSnap.id, leagueRequests: data.leagueRequests });
      }
    });
    return requests;
  } catch (error) {
    console.error("Error fetching all league requests:", error);
    return [];
  }
};