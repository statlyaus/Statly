import React, { useEffect, useState } from "react";
import { getAllLeagueRequests, updateLeagueRequestStatus } from "../firebaseHelpers";

type LeagueRequestStatus = "Pending" | "Approved" | "Rejected";

// Represents a single league join request for a user
interface LeagueRequest {
  leagueId: string;
  status: LeagueRequestStatus;
}

// Represents a user and all their league join requests
interface UserLeagueRequests {
  uid: string;
  leagueRequests: LeagueRequest[];
}

export default function CommissionerDashboard() {
  const [requests, setRequests] = useState<UserLeagueRequests[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllLeagueRequests()
      .then(setRequests)
      .catch((err) => {
        console.error("Failed to fetch league requests:", err);
        setError("Failed to fetch league requests.");
      });
  }, []);

  /**
   * Updates the status of a user's league join request and updates local state.
   */
  const handleAction = async (uid: string, leagueId: string, status: Exclude<LeagueRequestStatus, "Pending">) => {
    try {
      await updateLeagueRequestStatus(uid, leagueId, status);
      setRequests((prev) =>
        prev.map((user) =>
          user.uid === uid
            ? {
                ...user,
                leagueRequests: user.leagueRequests.map((req) =>
                  req.leagueId === leagueId ? { ...req, status } : req
                ),
              }
            : user
        )
      );
    } catch (err) {
      console.error("Failed to update league request status:", err);
      setError("Failed to update league request status.");
    }
  };

  return (
    <div>
      {error && (
        <p className="text-red-600 mb-2">{error}</p>
      )}
      {requests.length > 0 ? (
        <ul>
          {requests.map((user) =>
            user.leagueRequests.map((req) => (
              <li key={`${user.uid}-${req.leagueId}`} className="border-b pb-2">
                <div>
                  <span className="font-semibold">User:</span> {user.uid}
                  <span className="ml-4 font-semibold">League:</span> {req.leagueId}
                  <span className="ml-4 font-semibold">Status:</span> {req.status}
                </div>
                {req.status === "Pending" && (
                  <div className="mt-2 space-x-2">
                    <button
                      className="bg-green-600 text-white px-3 py-1 rounded"
                      onClick={() => handleAction(user.uid, req.leagueId, "Approved")}
                    >
                      Approve
                    </button>
                    <button
                      className="bg-red-600 text-white px-3 py-1 rounded"
                      onClick={() => handleAction(user.uid, req.leagueId, "Rejected")}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      ) : (
        <p>No league requests found.</p>
      )}
    </div>
  );
}
