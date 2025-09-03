// Server Component: SSR snapshot + provider bootstrap
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { adminAuth } from '@/lib/firebaseAdmin';
import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import { DraftProvider } from '@/contexts/DraftContext';
import { SocketProvider } from '@/context/SocketContext';

export const metadata: Metadata = {
  title: 'Draft Room • Statly',
  description: 'Live draft room with realtime picks and analytics.',
};

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
  // Relative fetch to your own app API; cookies forwarded for auth parity
  const res = await fetch(`/api/drafts/${draftId}`, {
    method: 'GET',
    headers: { cookie: buildCookieHeader() },
    cache: 'no-store',
  });

  if (!res.ok) return null;
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

  return (
    <SocketProvider>
      <DraftProvider draftId={draftId} userId={userId} initialSnapshot={initialSnapshot}>
        <UnifiedDraftRoom draftId={draftId} userId={userId} />
      </DraftProvider>
    </SocketProvider>
  );
}
