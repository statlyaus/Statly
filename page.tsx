'use client';

import { useAuth } from '@/AuthContext';
import Link from 'next/link';
import AuthForm from '@/components/AuthForm';

export default function HomePage() {
  const { user, logout } = useAuth();

  if (user) {
    return (
      <main className="container mx-auto p-6 text-center">
        <h1 className="text-3xl font-bold mb-2">Welcome back!</h1>
        <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
          You are logged in as <b>{user.email}</b>.
        </p>
        <div className="flex justify-center items-center gap-4">
          <Link href="/rosters" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
            View Rosters
          </Link>
          <button onClick={logout} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition">
            Log Out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-6 flex flex-col items-center">
        <h1 className="text-3xl font-bold mb-2">Welcome to Statly</h1>
        <p className="mb-8 text-gray-600 dark:text-gray-300">Please sign in or sign up to continue.</p>
        <AuthForm />
    </main>
  );
}