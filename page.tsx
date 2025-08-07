'use client';

import { useAuth } from '@/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If auth is not loading and there's no user, redirect to the login page.
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // While loading, or if there's no user yet, show a spinner.
  // This prevents a flash of the dashboard content before the redirect can happen.
  if (loading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <main className="container mx-auto p-6 text-center">
      <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
      <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
        Welcome back, <b>{user.email}</b>!
      </p>
      <div className="flex justify-center items-center gap-4">
        <Link href="/rosters" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
          View Your Rosters
        </Link>
        <button onClick={logout} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition">
          Log Out
        </button>
      </div>
    </main>
  );
}