'use client';

import { useEffect, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // Ignore parse errors and keep the provided initial value.
    }
    setHasHydrated(true);
  }, [initial, key]);

  useEffect(() => {
    if (!hasHydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [hasHydrated, key, value]);

  return [value, setValue] as const;
}
