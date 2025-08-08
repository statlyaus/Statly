'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/AuthContext';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Redirect once auth is resolved and user is present
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  // While we don't yet know, avoid flicker
  if (loading) {
    return (
      <main className="container mx-auto p-6" role="main" aria-busy="true">
        <h1 className="text-2xl font-bold">Loading…</h1>
        <p className="text-muted-foreground mt-2">Checking your session.</p>
      </main>
    );
  }

  // Not logged in → show landing/CTA
  if (!user) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Statly</h1>
        <p className="text-muted-foreground mt-2">
          Sign in to manage your AFL Fantasy team, draft players, and track stats.
        </p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/auth/sign-in"
            className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 font-semibold text-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Sign in to Statly"
          >
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Create a new Statly account"
          >
            Create Account
          </Link>
        </div>
      </main>
    );
  }

  // (Optional) If user exists we’ll be pushing; render a minimal placeholder.
  return (
    <main className="container mx-auto p-6" aria-busy="true">
      <p className="text-muted-foreground">Redirecting to your dashboard…</p>
    </main>
  );
}