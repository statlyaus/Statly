// src/lib/schedulingClient.ts
import type { LeagueSettings, ScheduleResult } from '@/lib/scheduling';

export async function generateScheduleViaApi(
  settings: LeagueSettings,
  signal?: AbortSignal
): Promise<ScheduleResult> {
  const res = await fetch('/api/scheduling/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
    signal,
  });

  // API returns ScheduleResult shape
  const json = (await res.json()) as ScheduleResult;

  if (!res.ok || json.success === false) {
    const errorMessage = (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string')
      ? json.error
      : `Schedule generation failed (HTTP ${res.status})`;
    throw new Error(errorMessage);
  }
  return json;
}
