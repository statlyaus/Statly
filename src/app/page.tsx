'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';
import Link from 'next/link';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // If the user is already logged in, redirect them to the dashboard.
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  // Development helper function
  const quickTestLogin = async () => {
    try {
      // Create test user and login
      const response = await fetch('/api/dev/test-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('🧪 Test user created/retrieved:', data.user.email);

        // Use the custom token to sign in
        const { signInWithCustomToken } = await import('firebase/auth');
        const { auth } = await import('@/lib/firebaseClient');

        if (auth) {
          await signInWithCustomToken(auth, data.customToken);
          console.log('✅ Test login successful');
          router.push('/leagues/test-league-id');
        }
      } else {
        console.error('Failed to create test user');
        // Fallback: just navigate to test the bypass
        router.push('/leagues/test-league-id');
      }
    } catch (error) {
      console.error('Test login failed:', error);
      // Fallback: just navigate to test the bypass
      router.push('/leagues/test-league-id');
    }
  };

  // Don't render the form if the user is logged in, to prevent a flash.
  if (user) {
    return null;
  }

  return (
    <div className="flex min-h-[calc(100vh-100px)] flex-col items-center justify-center space-y-4">
      <AuthForm />

      {/* Development Tools */}
      {process.env.NODE_ENV === 'development' && (
        <div className="border-t pt-4 mt-4 w-full max-w-sm">
          <h3 className="text-sm font-medium text-gray-600 mb-2">🧪 Development Tools</h3>
          <div className="space-y-2">
            <button
              onClick={async () => {
                try {
                  // Create a quick test draft
                  const response = await fetch('/api/drafts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: `Quick Test Draft ${Date.now()}`,
                      leagueSize: 12,
                      draftType: 'snake',
                      timePerPick: 120,
                    }),
                  });

                  if (response.ok) {
                    const { data: draft } = await response.json();
                    router.push(`/drafts/${draft.id}`);
                  } else {
                    // Fallback to existing draft
                    router.push('/drafts/cme98gp7p00047gbvh741f9tm');
                  }
                } catch (error) {
                  console.error('Failed to create test draft:', error);
                  // Fallback to existing draft
                  router.push('/drafts/cme98gp7p00047gbvh741f9tm');
                }
              }}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
            >
              🚀 Quick Test Draft
            </button>
            <Link
              href="/drafts/cme98gp7p00047gbvh741f9tm"
              className="block w-full bg-purple-600 text-white text-center py-2 px-4 rounded hover:bg-purple-700"
            >
              🎯 Test Draft Room (Skip Auth)
            </Link>
            <button
              onClick={quickTestLogin}
              className="w-full bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700"
            >
              ⚡ Quick Admin Login (League Owner)
            </button>
          </div>
        </div>
      )}

      <Link href="/tradecentre" className="text-blue-600 underline">
        Visit Trade Centre
      </Link>
    </div>
  );
}
