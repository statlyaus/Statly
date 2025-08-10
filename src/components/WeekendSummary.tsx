'use client';

import { useEffect, useState } from 'react';
import { fetchFromAPI } from '@/lib/api';

export default function WeekendSummary() {
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const data = await fetchFromAPI<{ summary?: string }>('/api/weekend-summary');
        setSummary(data.summary || '');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, []);

  return (
    <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
      <h2 className="text-xl font-bold mb-2">Weekend Summary</h2>
      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && (
        <p className="text-red-500">
          Error loading summary: {error}
        </p>
      )}
      {!loading && !error && <p className="text-muted-foreground">{summary}</p>}
    </article>
  );
}
