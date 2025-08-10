import React from 'react';
import { fetchFromAPI } from '@/lib/api';

export default async function WeekendSummary() {
  let summary = '';
  let error: string | null = null;

  try {
    const data = await fetchFromAPI<{ summary?: string }>(
      '/api/weekend-summary',
      { cache: 'force-cache' }
    );
    summary = data.summary || '';
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load';
  }

  return (
    <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
      <h2 className="text-xl font-bold mb-2">Weekend Summary</h2>
      {error ? (
        <p className="text-red-500">Error loading summary: {error}</p>
      ) : (
        <p className="text-muted-foreground">{summary}</p>
      )}
    </article>
  );
}
