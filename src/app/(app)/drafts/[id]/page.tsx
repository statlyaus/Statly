'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, LockKeyhole } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { DraftProvider } from '@/contexts/DraftContext';
import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import DraftErrorBoundary from '@/components/ui/ErrorBoundary';
import AppLayout from '@/components/navigation/AppLayout';

function DraftAccessState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof AlertTriangle;
}) {
  return (
    <AppLayout mode="shell">
      <div className="min-h-screen bg-muted px-4 py-10 text-foreground">
        <section className="mx-auto max-w-md rounded-[28px] border border-border bg-card p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-brand-bar">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <Link
            href="/drafts"
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-brand-bar px-5 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar focus-visible:ring-offset-2"
          >
            Draft center
          </Link>
        </section>
      </div>
    </AppLayout>
  );
}

export default function DraftPage() {
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
      <DraftProvider draftId={draftId} userId={user.uid}>
        <UnifiedDraftRoom draftId={draftId} userId={user.uid} />
      </DraftProvider>
    </DraftErrorBoundary>
  );
}
