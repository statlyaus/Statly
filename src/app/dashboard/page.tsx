"use client";
import Link from "next/link";
import { useAuth } from "@/AuthContext";
import { useMemo } from "react";
import DashboardLoading from "@/components/DashboardLoading";
import AuthCTA from "@/components/AuthCTA";

export default function Page() {
  const { user, logout, loading } = useAuth();

  const firstName = useMemo(() => {
    if (!user) {
      return "Guest";
    }
    // Prefer first name from displayName, fallback to email prefix
    return user.displayName?.trim().split(/\s+/)[0] || user.email?.split("@")[0] || "Guest";
  }, [user]);

  // It's good practice to show a loading state while auth status is being determined.
  // This prevents a "Welcome, Guest" flash for logged-in users on page load.
  if (loading) {
    return <DashboardLoading />;
  }

  if (!user) {
    return <AuthCTA />;
  }

  return (
    <>
      {/* Page header actions */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-900">Statly</h1>

        <div className="flex items-center gap-6">
          <span className="text-gray-900">
            Welcome, <span className="font-semibold">{firstName}</span>
          </span>

          <nav aria-label="Dashboard actions">
            <ul className="flex items-center gap-4">
              <li>
                <Link href="/players" className="text-blue-700 hover:underline">
                  Players
                </Link>
              </li>
              <li>
                <Link href="/tradecentre" className="text-blue-700 hover:underline">
                  Trade Centre
                </Link>
              </li>
            </ul>
          </nav>

          <button
            type="button"
            onClick={logout}
            className="text-red-700 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="p-6">
        <h2 className="text-2xl font-bold mb-2 text-gray-900">Dashboard</h2>
        <p className="text-gray-800">Welcome to your dashboard!</p>
      </main>
    </>
  );
}