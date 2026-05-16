import Link from 'next/link';

import { LogIn } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AuthCTA() {
  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="text-center max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-foreground">You&apos;re not signed in</h1>
        <p id="signin-description" className="mt-2 text-muted-foreground">
          Please sign in to view your dashboard and access all features.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className={cn(buttonVariants({ size: 'lg' }), 'font-semibold')}
            aria-describedby="signin-description"
          >
            <LogIn className="h-5 w-5" aria-hidden="true" />
            Sign In
          </Link>
        </div>
        <div className="mt-4">
          <Link
            href="/register"
            className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            Don&apos;t have an account? Sign up here
          </Link>
        </div>
      </div>
    </main>
  );
}
