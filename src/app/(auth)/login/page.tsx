import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in | Statly',
  description: 'Sign in to your Statly account',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; callbackUrl?: string };
}) {
  const nextUrl = searchParams?.callbackUrl || searchParams?.next;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Sign in</h1>
        <Suspense>
          <AuthForm
            initialMode="login"
            autoRedirectIfAuthenticated={true}
            nextUrl={nextUrl}
          />
        </Suspense>
        <div className="text-center">
          <Button href="/register" variant="secondary">
            Create account
          </Button>
          <div className="mt-2">
            <Button href="/forgot-password" variant="ghost">
              Forgot password?
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
