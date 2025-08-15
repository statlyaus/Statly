import Link from 'next/link';

export default function AuthCTA() {
  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8" role="main">
      <h1 className="text-3xl font-bold">You&apos;re not signed in</h1>
      <p className="text-muted-foreground mt-2">Please sign in to view your dashboard.</p>
      <div className="mt-4">
        <Link
          href="/login"
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-describedby="signin-description"
        >
          Sign In
        </Link>
        <span id="signin-description" className="sr-only">
          Navigate to the sign in page to access your dashboard
        </span>
      </div>
    </main>
  );
}
