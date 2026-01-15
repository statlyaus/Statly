import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchApi } from '@/lib/api';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import {
  CANONICAL_STAT_KEYS,
  STAT_COLUMNS,
  canonicalStatKeyFromCategory,
} from '@/lib/stats/statColumns';

const STORAGE_PREFIX = 'statCols:';

function getStorageKey(leagueId: string) {
  return `${STORAGE_PREFIX}${leagueId}`;
}

function readStoredKeys(leagueId: string): CanonicalStatKey[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(leagueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((key): key is CanonicalStatKey => CANONICAL_STAT_KEYS.includes(key));
  } catch {
    return null;
  }
}

type UseLeagueStatColumnsResult = {
  defaultKeys: CanonicalStatKey[];
  visibleKeys: CanonicalStatKey[];
  setVisibleKeys: (keys: CanonicalStatKey[]) => void;
  toggleKey: (key: CanonicalStatKey) => void;
  allKeys: CanonicalStatKey[];
  labels: typeof STAT_COLUMNS;
  loading: boolean;
  error: string | null;
};

export function useLeagueStatColumns(leagueId?: string): UseLeagueStatColumnsResult {
  const [defaultKeys, setDefaultKeys] = useState<CanonicalStatKey[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<CanonicalStatKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) {
      setDefaultKeys([]);
      setVisibleKeys([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchCategories = async () => {
      try {
        const response = await fetchApi(`leagues/${leagueId}`);
        const responseData = (response as Record<string, unknown>)?.data as
          | { league?: { categories?: unknown[] } }
          | undefined;
        const categories = responseData?.league?.categories ?? [];
        const canonical = Array.isArray(categories)
          ? (categories
              .map((value) => canonicalStatKeyFromCategory(String(value)))
              .filter(Boolean) as CanonicalStatKey[])
          : [];
        const resolvedDefaults =
          canonical.length > 0 ? canonical : CANONICAL_STAT_KEYS.slice(0);
        const stored = readStoredKeys(leagueId);
        if (cancelled) return;
        setDefaultKeys(resolvedDefaults);
        setVisibleKeys(stored && stored.length > 0 ? stored : resolvedDefaults);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load league categories.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchCategories();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(getStorageKey(leagueId), JSON.stringify(visibleKeys));
    } catch {
      // ignore storage errors
    }
  }, [leagueId, visibleKeys]);

  const toggleKey = useCallback((key: CanonicalStatKey) => {
    setVisibleKeys((prev) =>
      prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key]
    );
  }, []);

  const setVisibleKeysSafe = useCallback(
    (keys: CanonicalStatKey[]) => {
      setVisibleKeys(keys.filter((key) => CANONICAL_STAT_KEYS.includes(key)));
    },
    []
  );

  const labels = useMemo(() => STAT_COLUMNS, []);

  return {
    defaultKeys,
    visibleKeys,
    setVisibleKeys: setVisibleKeysSafe,
    toggleKey,
    allKeys: CANONICAL_STAT_KEYS,
    labels,
    loading,
    error,
  };
}
