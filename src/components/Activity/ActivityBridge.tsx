'use client';

import { useEffect } from 'react';

import { useActivity, type ActivityType } from '@/components/Activity/ActivityProvider';

/**
 * Listens for window CustomEvent('statly:activity', { detail: { type, message, meta } })
 * and forwards entries to ActivityProvider.
 */
export default function ActivityBridge() {
  const { addEntry } = useActivity();

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        type: ActivityType;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!ce.detail?.message || !ce.detail?.type) return;
      addEntry({ type: ce.detail.type, message: ce.detail.message, meta: ce.detail.meta });
    };
    window.addEventListener('statly:activity', handler as EventListener);
    return () => window.removeEventListener('statly:activity', handler as EventListener);
  }, [addEntry]);

  return null;
}
