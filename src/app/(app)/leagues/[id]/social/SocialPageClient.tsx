'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { AppLayout } from '@/components/navigation';
import { LeagueSocialShell, type LeagueSocialView } from '@/components/league/social';

export default function SocialPageClient({
  leagueId,
  leagueName,
  userId,
  initialView,
  initialPostId,
}: {
  leagueId: string;
  leagueName: string;
  userId: string;
  initialView: LeagueSocialView;
  initialPostId?: string;
}): React.JSX.Element {
  return (
    <AppLayout>
      <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Link
            href={`/leagues/${encodeURIComponent(leagueId)}`}
            className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to {leagueName}
          </Link>
          <LeagueSocialShell
            leagueId={leagueId}
            currentUserId={userId}
            initialView={initialView}
            initialPostId={initialPostId}
            title={`${leagueName} social`}
          />
        </div>
      </main>
    </AppLayout>
  );
}
