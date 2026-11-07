'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { hrefWith, type SearchParams } from './searchParams';

/**
 * Replaces the page URL's search params; the server page re-renders with the new view state.
 * `optimistic` runs in the same transition, so a control can show its new state (via
 * `useOptimistic`) until the server render lands.
 */
export function useParamNavigation(path: string, params: SearchParams) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const update = (updates: Record<string, string | null>, optimistic?: () => void) =>
    startTransition(() => {
      optimistic?.();
      router.replace(hrefWith(path, params, updates), { scroll: false });
    });
  return { update, pending };
}
