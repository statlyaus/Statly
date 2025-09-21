"use client";

import { useEffect } from 'react';
import { useToast } from '@/components/Toast/ToastProvider';

/**
 * Listens for window CustomEvents and forwards them to the toast system.
 *
 * Usage: dispatch a CustomEvent('statly:toast', { detail: { title, message, variant, timeoutMs } })
 */
export default function ToastBridge() {
  const { show } = useToast();

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ title?: string; message: string; variant?: 'info'|'success'|'warning'|'error'; timeoutMs?: number }>;
      if (!ce.detail?.message) return;
      show({
        title: ce.detail.title,
        message: ce.detail.message,
        variant: ce.detail.variant ?? 'info',
        timeoutMs: ce.detail.timeoutMs ?? 4000,
      });
    };
    window.addEventListener('statly:toast', handler as EventListener);
    return () => window.removeEventListener('statly:toast', handler as EventListener);
  }, [show]);

  return null;
}
