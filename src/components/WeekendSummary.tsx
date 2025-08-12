'use client';

import { useState, useEffect } from 'react';
import { fetchFromAPI } from '@/lib/api';
import { logger } from '@/lib/logger';

export default function WeekendSummary() {
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const data = await fetchFromAPI<{ summary: string }>('/api/weekend-summary');
        setSummary(data.summary || 'No summary available.');
      } catch (err) {
        logger.error('Failed to fetch weekend summary', err);
        setError(err instanceof Error ? err.message : 'Failed to load summary');
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
      {!loading && !error && (
        <div className="prose prose-sm">
          <p>{summary}</p>
        </div>
      )}
    </article>
  );
}
