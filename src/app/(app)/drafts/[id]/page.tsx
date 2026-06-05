'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, LockKeyhole } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { DraftProvider } from '@/contexts/DraftContext';
import { SocketProvider } from '@/contexts/SocketContext';
import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import DraftErrorBoundary from '@/components/ui/ErrorBoundary';
import { AppLayout } from '@/components/navigation';

function DraftAccessState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof AlertTriangle;
}): JSX.Element {
  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-10 text-[color:var(--league-text)]">
        <section className="mx-auto max-w-md rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
            {description}
          </p>
          <Link
            href="/drafts"
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
          >
            Draft center
          </Link>
        </section>
      </main>
    </AppLayout>
  );
}

export default function DraftPage(): JSX.Element {
  const params = useParams();
  const { user } = useAuth();

  if (!params?.id || Array.isArray(params.id)) {
    return (
      <DraftAccessState
        title="Invalid draft"
        description="The draft room could not be found. Return to the draft center and choose an active room."
        icon={AlertTriangle}
      />
    );
  }

  const draftId = params.id;

  // Redirect if not authenticated
  if (!user) {
    return (
      <DraftAccessState
        title="Authentication required"
        description="Sign in before entering a live draft room so picks, queues, and readiness stay attached to your team."
        icon={LockKeyhole}
      />
    );
  }

  return (
    <DraftErrorBoundary>
      <SocketProvider uid={user.uid}>
        <DraftProvider draftId={draftId} userId={user.uid}>
          <UnifiedDraftRoom draftId={draftId} userId={user.uid} />
        </DraftProvider>
      </SocketProvider>
    </DraftErrorBoundary>
  );
}
