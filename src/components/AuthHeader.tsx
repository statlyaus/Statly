'use client';

import { useAuth } from '@/AuthContext';

export default function AuthHeader() {
  const { user, loginWithGoogle, logout } = useAuth();

  return user ? (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-gray-400">
        Welcome, <span className="text-white font-medium">{user.displayName}</span>
      </p>
      <button onClick={logout} className="btn btn-outline btn-sm">
        Sign out
      </button>
    </div>
  ) : (
    <button onClick={loginWithGoogle} className="btn btn-primary btn-sm">
      Sign in with Google
    </button>
  );
}
