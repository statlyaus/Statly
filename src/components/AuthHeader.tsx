"use client";

import { useAuth } from "../Contexts/AuthContext";

export default function AuthHeader() {
  const { user, signInWithGoogle, logout, loading } = useAuth();

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return user ? (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-gray-400">Welcome, <span className="text-white font-medium">{user.displayName}</span></p>
      <button onClick={logout} className="btn btn-outline btn-sm">
        Sign out
      </button>
    </div>
  ) : (
    <button onClick={signInWithGoogle} className="btn btn-primary btn-sm">
      Sign in with Google
    </button>
  );
}