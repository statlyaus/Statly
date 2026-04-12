'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ActivityType = 'draft' | 'trade' | 'waiver' | 'system';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

interface ActivityContextValue {
  entries: ActivityEntry[];
  addEntry: (e: Omit<ActivityEntry, 'id' | 'timestamp'> & { timestamp?: string }) => void;
  clear: () => void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  const addEntry = useCallback(
    (e: Omit<ActivityEntry, 'id' | 'timestamp'> & { timestamp?: string }) => {
      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timestamp = e.timestamp ?? new Date().toISOString();
      setEntries((list) =>
        [{ id, type: e.type, message: e.message, timestamp, meta: e.meta }, ...list].slice(0, 200)
      );
    },
    []
  );

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo(() => ({ entries, addEntry, clear }), [entries, addEntry, clear]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity must be used within ActivityProvider');
  return ctx;
}
