// Server Component: SSR snapshot + provider bootstrap
export const runtime = 'nodejs';

import { cookies } from 'next/headers';

import DraftPageClient from './DraftPageClient';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getBypassUserId, isAuthBypassEnabled } from '@/lib/authBypass';

import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: draftId } = await params;
  
  try {
    const draftData = await fetchDraftSnapshot(draftId);
    
    if (draftData?.name) {
      return {
        title: `${draftData.name} • Statly`,
        description: `Live draft room for ${draftData.name} with realtime picks and analytics.`,
      };
    }
  } catch (error) {
    // Fall back to static metadata if fetch fails
    console.warn('Failed to fetch draft data for metadata:', error);
  }
  
  // Fallback to static metadata
  return {
    title: 'Draft Room • Statly',
    description: 'Live draft room with realtime picks and analytics.',
  };
}

async function buildCookieHeader(): Promise<string> {
  const all = (await cookies()).getAll();
  if (!all.length) return '';
  return all.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
}

async function getUserIdFromSession(): Promise<string> {
  if (isAuthBypassEnabled()) {
    return getBypassUserId();
  }
  const sessionCookie = (await cookies()).get('statly_session')?.value;
  if (!sessionCookie) return 'anonymous';
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid as string;
  } catch {
    return 'anonymous';
  }
}

async function fetchDraftSnapshot(draftId: string): Promise<Record<string, any> | null> {
  // Relative fetch to your own app API; cookies forwarded for auth parity
  const res = await fetch(`/api/drafts/${draftId}`, {
    method: 'GET',
    headers: { cookie: await buildCookieHeader() },
    cache: 'no-store',
  });

  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return (json?.data ?? json ?? null) as Record<string, any> | null;
}

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: draftId } = await params;
  const userId = await getUserIdFromSession();
  const initialSnapshot = await fetchDraftSnapshot(draftId);

  return <DraftPageClient draftId={draftId} userId={userId} initialSnapshot={initialSnapshot} />;
}
