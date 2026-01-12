// Server Component: SSR snapshot + provider bootstrap
export const runtime = 'nodejs';

import type React from 'react';

import { cookies, headers } from 'next/headers';


import { getBypassUserId, isAuthBypassEnabled } from '@/lib/authBypass';
import { adminAuth } from '@/lib/firebaseAdmin';

import DraftPageClient from './DraftPageClient';

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

async function fetchDraftSnapshot(draftId: string): Promise<Record<string, unknown> | null> {
  // Resolve base URL from env or request headers to work in dev and prod
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? undefined;
  const proto =
    hdrs.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const envBase =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const baseUrl = envBase || (host ? `${proto}://${host}` : undefined) || 'http://localhost:3000';

  const url = new URL(`/api/drafts/${draftId}`, baseUrl).toString();

  const res = await fetch(url, {
    method: 'GET',
    headers: { cookie: await buildCookieHeader() },
    cache: 'no-store',
  });

  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return (json?.data ?? json ?? null) as Record<string, unknown> | null;
}

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id: draftId } = await params;
  const userId = await getUserIdFromSession();
  const initialSnapshot = await fetchDraftSnapshot(draftId);

  return <DraftPageClient draftId={draftId} userId={userId} initialSnapshot={initialSnapshot} />;
}
