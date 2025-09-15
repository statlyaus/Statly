'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Button from '@/components/Button';

type WorkerMetrics = {
  jobsProcessed: number;
  jobsFailed: number;
  averageProcessingTime: number;
  lastActivity: string; // ISO from API
  workerId: string;
};

type PoolStats = {
  workerCount: number;
  totalJobsProcessed: number;
  totalJobsFailed: number;
  averageProcessingTime: number;
  successRate: number;
  workers: WorkerMetrics[];
};

type WorkerHealth = { id: string; healthy: boolean; error?: string };
type PoolHealth = { healthy: boolean; workers: WorkerHealth[] };
type CombinedData = { stats: PoolStats; health: PoolHealth };

const POLL_INTERVAL_MS = 10_000;

const formatMs = (ms: number) => {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
};
const timeAgo = (iso: string) => {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  if (diff < 1_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
};

const usePolling = (enabled: boolean, callback: () => void, intervalMs: number) => {
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
};

export default function AdminWorkersClient() {
  const [data, setData] = useState<CombinedData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [actionLoading, setActionLoading] = useState<null | 'start' | 'stop' | 'restart' | 'add' | `remove:${string}`>(null);

  const fetchData = useCallback(async () => {
    setIsLoading((prev) => (!data ? true : prev));
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/workers', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      const json = (await res.json()) as { success: boolean; data: CombinedData };
      if (!json.success) throw new Error('Request unsuccessful');
      setData(json.data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  usePolling(isPolling, () => void fetchData(), POLL_INTERVAL_MS);

  const poolHealthy = data?.health.healthy ?? false;
  const mergedWorkers = useMemo(() => {
    if (!data) return [] as Array<WorkerMetrics & { health?: WorkerHealth }>;
    const healthById = new Map(data.health.workers.map((w) => [w.id, w] as const));
    return data.stats.workers.map((w) => ({ ...w, health: healthById.get(w.workerId) }));
  }, [data]);

  const handleAction = useCallback(
    async (action: 'start' | 'stop' | 'restart' | 'add' | 'remove', workerId?: string) => {
      if (action === 'remove' && !workerId) return;
      setErrorMessage(null);
      const loadingKey: null | 'start' | 'stop' | 'restart' | 'add' | `remove:${string}` =
        action === 'remove' && workerId ? (`remove:${workerId}` as const) : (action as Exclude<typeof action, 'remove'>);
      setActionLoading(loadingKey);
      try {
        const res = await fetch('/api/admin/workers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action === 'add' ? 'addWorker' : action === 'remove' ? 'removeWorker' : action, workerId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          throw new Error(json?.error || `Action '${action}' failed`);
        }
        await fetchData();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setActionLoading(null);
      }
    },
    [fetchData]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent, onActivate: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  }, []);

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6" aria-label="Admin Workers" tabIndex={0}>
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Worker Pool</h1>
          <p className="text-sm text-gray-600">Monitor and control draft worker pool. Polls every {Math.round(POLL_INTERVAL_MS / 1000)}s.</p>
        </div>

        <div className="flex items-center gap-3">
          <span className={clsx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium', poolHealthy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')} aria-label={poolHealthy ? 'Pool healthy' : 'Pool unhealthy'} role="status">
            <span className={clsx('h-2 w-2 rounded-full', poolHealthy ? 'bg-green-500' : 'bg-red-500')} />
            {poolHealthy ? 'Healthy' : 'Unhealthy'}
          </span>

          <div className="flex items-center gap-2">
            <label htmlFor="poll-toggle" className="text-sm text-gray-700">Auto-refresh</label>
            <button id="poll-toggle" type="button" aria-label={isPolling ? 'Disable auto refresh' : 'Enable auto refresh'} className={clsx('relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200', isPolling ? 'bg-blue-600' : 'bg-gray-200')} onClick={() => setIsPolling((s) => !s)} onKeyDown={(e) => handleKeyDown(e, () => setIsPolling((s) => !s))}>
              <span className={clsx('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200', isPolling ? 'translate-x-5' : 'translate-x-0')} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {errorMessage && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700">Pool Summary</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Workers</div>
              <div className="font-semibold">{data?.stats.workerCount ?? '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">Success Rate</div>
              <div className="font-semibold">{data ? `${Math.round((data.stats.successRate ?? 0) * 100)}%` : '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">Avg Time</div>
              <div className="font-semibold">{data ? formatMs(data.stats.averageProcessingTime ?? 0) : '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">Total Jobs</div>
              <div className="font-semibold">{data ? data.stats.totalJobsProcessed : '-'}</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Workers</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleAction('add')}>Add Worker</Button>
              <Button size="sm" onClick={() => void handleAction('restart')}>Restart All</Button>
              <Button size="sm" onClick={() => void handleAction('stop')}>Stop All</Button>
            </div>
          </div>
          <div className="mt-3 divide-y">
            {mergedWorkers.map((w) => (
              <div key={w.workerId} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className={clsx('h-2 w-2 rounded-full', w.health?.healthy ? 'bg-green-500' : 'bg-red-500')} />
                  <div>
                    <div className="font-medium">{w.workerId}</div>
                    <div className="text-xs text-gray-500">Last activity {timeAgo(w.lastActivity)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500">Processed</div>
                    <div className="font-semibold">{w.jobsProcessed}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Failed</div>
                    <div className="font-semibold">{w.jobsFailed}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Avg</div>
                    <div className="font-semibold">{formatMs(w.averageProcessingTime)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void handleAction('restart', w.workerId)}>Restart</Button>
                  <Button size="sm" onClick={() => void handleAction('remove', w.workerId)}>Remove</Button>
                </div>
              </div>
            ))}
            {!mergedWorkers.length && <div className="py-6 text-center text-sm text-gray-500">No workers</div>}
          </div>
        </div>
      </section>
    </main>
  );
}
