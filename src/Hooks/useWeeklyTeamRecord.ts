// src/hooks/useWeeklyTeamRecord.ts
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

type TeamRecord = {
  wins: number;
  losses: number;
  draws: number;
  formatted: string;
  loading: boolean;
  error: string | null;
};

export const useWeeklyTeamRecord = (userId: string, round?: number) => {
  const [record, setRecord] = useState<TeamRecord>({
    wins: 0,
    losses: 0,
    draws: 0,
    formatted: "Loading...",
    loading: true,
    error: null
  });

  useEffect(() => {
    const fetchMatchup = async () => {
      if (!userId) {
        setRecord(prev => ({ ...prev, loading: false, error: "No user ID provided" }));
        return;
      }

      try {
        setRecord(prev => ({ ...prev, loading: true, error: null }));

        const q = query(
          collection(db, "matchups"),
          where("participants", "array-contains", userId),
          ...(round ? [where("round", "==", round)] : []) // Optional round filter
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setRecord({
            wins: 0,
            losses: 0,
            draws: 0,
            formatted: "No matches found",
            loading: false,
            error: null
          });
          return;
        }

        let wins = 0, losses = 0, draws = 0;

        snapshot.forEach(doc => {
          const data = doc.data();
          const results = data?.results?.[userId];
          
          if (Array.isArray(results)) {
            results.forEach((result: string) => {
              switch (result.toLowerCase()) {
                case "win":
                  wins++;
                  break;
                case "loss":
                  losses++;
                  break;
                case "draw":
                  draws++;
                  break;
              }
            });
          }
        });

        setRecord({
          wins,
          losses,
          draws,
          formatted: `${wins}–${losses}–${draws}`,
          loading: false,
          error: null
        });

      } catch (err) {
        console.error("Error fetching matchup record:", err);
        setRecord(prev => ({
          ...prev,
          loading: false,
          error: "Failed to load record"
        }));
      }
    };

    fetchMatchup();
  }, [userId, round]);

  return record;
};