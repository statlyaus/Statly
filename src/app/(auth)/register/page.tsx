import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Create account | Statly',
  description: 'Create your Statly account',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const pickFirst = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const toSafeRedirect = (url?: string) =>
    url && url.startsWith('/') && !url.startsWith('//') ? url : undefined;
  const nextUrl =
    toSafeRedirect(pickFirst(params.callbackUrl)) ??
    toSafeRedirect(pickFirst(params.next));

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Create account</h1>
        <Suspense>
          <AuthForm
            initialMode="signup"
            autoRedirectIfAuthenticated={true}
            nextUrl={nextUrl}
          />
        </Suspense>
        <div className="text-center">
          <Button href="/login" variant="secondary">
            Have an account? Log in
          </Button>
        </div>
      </div>
    </main>
  );
}
