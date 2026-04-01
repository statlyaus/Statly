"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  timeoutMs?: number;
}

interface ToastContextValue {
  show: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `toast_${Date.now()}_${nextIdRef.current++}`;
      const toast: Toast = { id, timeoutMs: 4000, ...t, variant: t.variant ?? 'info' };
      setToasts((list) => [toast, ...list]);
      if (toast.timeoutMs && toast.timeoutMs > 0) {
        setTimeout(() => dismiss(id), toast.timeoutMs);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {/* Live region for SR announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {toasts[0]?.message}
      </div>
      {children}
      {typeof window !== 'undefined' &&
        createPortal(
          <div className="fixed z-50 right-4 bottom-4 space-y-2 max-w-sm">
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                className={`rounded-lg border p-3 shadow bg-white ${
                  t.variant === 'success'
                    ? 'border-emerald-200'
                    : t.variant === 'warning'
                    ? 'border-amber-200'
                    : t.variant === 'error'
                    ? 'border-red-200'
                    : 'border-neutral-200'
                }`}
              >
                {t.title && <div className="text-sm font-semibold mb-0.5">{t.title}</div>}
                <div className="text-sm text-neutral-700">{t.message}</div>
                <button
                  className="mt-2 text-xs text-blue-700 hover:underline"
                  onClick={() => dismiss(t.id)}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
