import React, { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { loadUserSettings, saveUserSettings, loadUserLeagueRequests, saveUserLeagueRequests } from "../firebaseHelpers";

const defaultSettings = {
  theme: "light",
  notifications: true,
  favoriteTeam: "",
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [leagueRequests, setLeagueRequests] = useState<{ leagueId: string; status: string }[]>([]);
  const [newLeagueId, setNewLeagueId] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    loadUserSettings(user.uid).then((data) => {
      setSettings({ ...defaultSettings, ...data });
      setLoading(false);
    });
  }, [user?.uid]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const { name, value, type } = target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (target as HTMLInputElement).checked : value,
    }));
  };

  useEffect(() => {
    if (!user?.uid) return;
    const handler = setTimeout(() => {
      saveUserSettings(user.uid, settings);
    }, 500); // 500ms debounce
    return () => clearTimeout(handler);
  }, [user?.uid, settings]);

  // Load league requests on login
  useEffect(() => {
    if (!user?.uid) return;
  // Save league requests when changed (debounced)
  useEffect(() => {
    if (!user?.uid) return;
    const handler = setTimeout(() => {
      saveUserLeagueRequests(user.uid, leagueRequests);
    }, 500); // 500ms debounce
    return () => clearTimeout(handler);
  }, [user?.uid, leagueRequests]);
    if (!user?.uid) return;
    saveUserLeagueRequests(user.uid, leagueRequests);
  }, [user?.uid, leagueRequests]);

  const handleLeagueRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeagueId.trim()) return;
    setLeagueRequests(prev => [
      ...prev,
      { leagueId: newLeagueId.trim(), status: "Pending" }
    ]);
    setNewLeagueId("");
  };

  if (loading) return <div className="p-4">Loading settings...</div>;

  return (
    <div className="max-w-lg mx-auto p-6 bg-white rounded shadow mt-8">
      <h2 className="text-2xl font-bold mb-4">Settings</h2>
      <form className="space-y-4">
        <div>
          <label className="block font-semibold mb-1">Theme</label>
          <select
            name="theme"
            value={settings.theme}
            onChange={handleChange}
            className="w-full border px-2 py-1 rounded"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">
            <input
              type="checkbox"
              name="notifications"
              checked={settings.notifications}
              onChange={handleChange}
              className="mr-2"
            />
            Enable Notifications
          </label>
        </div>
        <div>
          <label className="block font-semibold mb-1">Favorite Team</label>
          <input
            type="text"
            name="favoriteTeam"
            value={settings.favoriteTeam}
            onChange={handleChange}
            className="w-full border px-2 py-1 rounded"
            placeholder="e.g. Collingwood"
          />
        </div>
      </form>
      <p className="text-xs text-gray-500 mt-2">Changes are saved automatically.</p>
      <div className="mt-8">
        <h3 className="text-lg font-bold mb-2">League Join Requests</h3>
        <form onSubmit={handleLeagueRequest} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newLeagueId}
            onChange={e => setNewLeagueId(e.target.value)}
            placeholder="Enter League ID"
            className="border px-2 py-1 rounded flex-1"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-1 rounded"
          >
            Request to Join
          </button>
        </form>
        {leagueRequests.length === 0 ? (
          <p className="text-gray-500">No league join requests yet.</p>
        ) : (
          <ul className="list-disc pl-5">
            {leagueRequests.map((req) => (
              <li key={req.leagueId}>
                League ID: <b>{req.leagueId}</b> — <span className="text-xs">{req.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
