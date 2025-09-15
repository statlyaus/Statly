'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';

export default function LoginClient() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const quickTestLogin = async () => {
    try {
      const response = await fetch('/api/dev/test-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        const { signInWithCustomToken } = await import('firebase/auth');
        const { auth } = await import('@/lib/firebaseClient');
        if (auth) {
          await signInWithCustomToken(auth, data.customToken);
          router.push('/leagues/test-league-id');
        }
      } else {
        router.push('/leagues/test-league-id');
      }
    } catch (error) {
      router.push('/leagues/test-league-id');
    }
  };

  if (user) return null;

  return (
    <div className="flex min-h-[calc(100vh-100px)] flex-col items-center justify-center space-y-4">
      <AuthForm />

      {process.env.NODE_ENV === 'development' && (
        <div className="border-t pt-4 mt-4 w-full max-w-sm">
          <h3 className="text-sm font-medium text-gray-600 mb-2">🧪 Development Tools</h3>
          <div className="space-y-2">
            <button
              onClick={async () => {
                try {
                  const response = await fetch('/api/drafts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `Quick Test Draft ${Date.now()}`, leagueSize: 12, draftType: 'snake', timePerPick: 120 }),
                  });
                  if (response.ok) {
                    const { data: draft } = await response.json();
                    router.push(`/drafts/${draft.id}`);
                  } else {
                    router.push('/drafts/cme98gp7p00047gbvh741f9tm');
                  }
                } catch (error) {
                  router.push('/drafts/cme98gp7p00047gbvh741f9tm');
                }
              }}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
            >
              🚀 Quick Test Draft
            </button>
            <Link href="/drafts/cme98gp7p00047gbvh741f9tm" className="block w-full bg-purple-600 text-white text-center py-2 px-4 rounded hover:bg-purple-700">
              🎯 Test Draft Room (Skip Auth)
            </Link>
            <button onClick={quickTestLogin} className="w-full bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700">
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

