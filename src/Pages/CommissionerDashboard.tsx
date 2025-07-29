import React, { useEffect, useState } from "react";
import { getAllLeagueRequests, updateLeagueRequestStatus } from "../firebaseHelpers";

export default function CommissionerDashboard() {
  const [requests, setRequests] = useState<
    { uid: string; leagueRequests: { leagueId: string; status: string }[] }[]
  >([]);

  useEffect(() => {
    getAllLeagueRequests().then(setRequests);
  }, []);

  const handleAction = async (uid: string, leagueId: string, status: "Approved" | "Rejected") => {
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
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow mt-8">
      <h2 className="text-2xl font-bold mb-4">Commissioner: League Join Requests</h2>
      {requests.length === 0 ? (
        <p className="text-gray-500">No join requests found.</p>
      ) : (
        <ul className="space-y-4">
          {requests.map((user) =>
            user.leagueRequests.map((req, idx) => (
              <li key={user.uid + req.leagueId + idx} className="border-b pb-2">
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
      )}
    </div>
  );
}
