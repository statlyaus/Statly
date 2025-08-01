// src/app/page.tsx
"use client";

import { useAuth } from "@/context/AuthContext";

export default function LandingPage() {
  const { user, loading, signInWithGoogle, logout } = useAuth();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-center p-6">
      <h1 className="text-4xl font-bold mb-4 text-blue-600">Welcome to Statly AFL</h1>
      <p className="text-gray-700 mb-8 text-lg">
        Your home for AFL Fantasy Draft stats, teams, trades, and more.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Checking authentication...</p>
      ) : user ? (
        <div className="flex flex-col items-center space-y-4">
          <p className="text-xl font-semibold">Hello, {user.displayName}</p>
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt="User avatar"
              className="w-16 h-16 rounded-full shadow"
            />
          )}
          <button
            onClick={logout}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
          >
            Log out
          </button>
        </div>
      ) : (
        <button
          onClick={signInWithGoogle}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
        >
          Sign in with Google
        </button>
      )}
    </main>
  );
}