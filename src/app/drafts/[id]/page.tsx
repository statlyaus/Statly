// Server Component: SSR snapshot + provider bootstrap
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { adminAuth } from '@/lib/firebaseAdmin';
import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import { DraftProvider } from '@/contexts/DraftContext';

// Optional: tweak as you like
export const metadata: Metadata = {
  title: 'Draft Room • Statly',
  description: 'Live draft room with realtime picks and analytics.',
};

// Small helper: forward all cookies to internal API fetch
function buildCookieHeader() {
  const all = cookies().getAll();
  if (!all.length) return '';
  return all.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
}

async function getUserIdFromSession(): Promise<string> {
  const sessionCookie = cookies().get('statly_session')?.value;
  if (!sessionCookie) return 'anonymous';
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid as string;
  } catch {
    return 'anonymous';
  }
}

async function fetchDraftSnapshot(draftId: string) {
  // Call your internal API. We forward cookies for auth/visibility parity.
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/drafts/${draftId}`, {
    method: 'GET',
    headers: {
      cookie: buildCookieHeader(),
      // Optional: any tracing headers you want to pass through
    },
    // We want fresh state on load; cache can be tuned later per your needs
    cache: 'no-store',
  });

  if (!res.ok) {
    // Return null; client will still mount with socket + forceRefresh if needed
    return null;
  }

  // Many of your APIs wrap in { success, data }. Handle both raw/success-wrapped.
  const json = await res.json().catch(() => null);
  return json?.data ?? json ?? null;
}

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: draftId } = await params;
  const userId = await getUserIdFromSession();
  const initialSnapshot = await fetchDraftSnapshot(draftId);

  // We keep SSR simple: render the room either way.
  // If snapshot is null, DraftProvider starts in loading state and socket/backfill will sync it.
  return (
    <DraftProvider draftId={draftId} userId={userId} initialSnapshot={initialSnapshot}>
      <UnifiedDraftRoom draftId={draftId} userId={userId} />
    </DraftProvider>
  );
}
