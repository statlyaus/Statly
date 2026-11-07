'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { hrefWith, type SearchParams } from './searchParams';

/** Replaces the page URL's search params; the server page re-renders with the new view state. */
export function useParamNavigation(path: string, params: SearchParams) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const update = (updates: Record<string, string | null>) =>
    startTransition(() => router.replace(hrefWith(path, params, updates), { scroll: false }));
  return { update, pending };
}
