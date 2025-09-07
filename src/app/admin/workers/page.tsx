'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/Button';
import clsx from 'clsx';

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

type WorkerHealth = {
  id: string;
  healthy: boolean;
  error?: string;
};

type PoolHealth = {
  healthy: boolean;
  workers: WorkerHealth[];
};

type CombinedData = {
  stats: PoolStats;
  health: PoolHealth;
};

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

export default function AdminWorkersPage() {
  const [data, setData] = useState<CombinedData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [actionLoading, setActionLoading] = useState<
    null | 'start' | 'stop' | 'restart' | 'add' | `remove:${string}`
  >(null);

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
      setActionLoading(action === 'remove' && workerId ? (`remove:${workerId}` as const) : action);
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
        // Refresh immediately after successful action
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
          <p className="text-sm text-gray-600">
            Monitor and control draft worker pool. Polls every {Math.round(POLL_INTERVAL_MS / 1000)}s.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium',
              poolHealthy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            )}
            aria-label={poolHealthy ? 'Pool healthy' : 'Pool unhealthy'}
            role="status"
          >
            <span className={clsx('h-2 w-2 rounded-full', poolHealthy ? 'bg-green-500' : 'bg-red-500')} />
            {poolHealthy ? 'Healthy' : 'Unhealthy'}
          </span>

          <div className="flex items-center gap-2">
            <label htmlFor="poll-toggle" className="text-sm text-gray-700">
              Auto-refresh
            </label>
            <button
              id="poll-toggle"
              type="button"
              aria-label={isPolling ? 'Disable auto refresh' : 'Enable auto refresh'}
              className={clsx(
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                isPolling ? 'bg-blue-600' : 'bg-gray-200'
              )}
              onClick={() => setIsPolling((s) => !s)}
              onKeyDown={(e) => handleKeyDown(e, () => setIsPolling((s) => !s))}
            >
              <span
                className={clsx(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                  isPolling ? 'translate-x-5' : 'translate-x-0'
                )}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          aria-live="polite"
        >
          {errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Workers" value={data?.stats.workerCount ?? 0} />
        <StatCard label="Jobs Processed" value={data?.stats.totalJobsProcessed ?? 0} />
        <StatCard label="Jobs Failed" value={data?.stats.totalJobsFailed ?? 0} />
        <StatCard label="Success Rate" value={`${(data?.stats.successRate ?? 0).toFixed(1)}%`} />
      </section>

      <section aria-label="Pool Controls" className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void handleAction('start')}
          loading={actionLoading === 'start'}
          aria-label="Start worker pool"
        >
          Start
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleAction('stop')}
          loading={actionLoading === 'stop'}
          aria-label="Stop worker pool"
        >
          Stop
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleAction('restart')}
          loading={actionLoading === 'restart'}
          aria-label="Restart worker pool"
        >
          Restart
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleAction('add')}
          loading={actionLoading === 'add'}
          aria-label="Add worker"
        >
          Add Worker
        </Button>
      </section>

      <section aria-label="Workers Table" className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Worker</Th>
                <Th>Status</Th>
                <Th className="text-right">Jobs</Th>
                <Th className="text-right">Failed</Th>
                <Th className="text-right">Avg Time</Th>
                <Th className="text-right">Last Activity</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading && (
                <tr>
                  <td className="p-4 text-sm text-gray-500" colSpan={7}>
                    Loading...
                  </td>
                </tr>
              )}

              {!isLoading && mergedWorkers.length === 0 && (
                <tr>
                  <td className="p-4 text-sm text-gray-500" colSpan={7}>
                    No workers available.
                  </td>
                </tr>
              )}

              {mergedWorkers.map((w) => {
                const isHealthy = w.health?.healthy ?? false;
                const removeKey = (`remove:${w.workerId}` as const);
                return (
                  <tr key={w.workerId} className="hover:bg-gray-50">
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{w.workerId}</span>
                      </div>
                    </Td>
                    <Td>
                      <span
                        className={clsx(
                          'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',
                          isHealthy ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        )}
                        aria-label={isHealthy ? 'Healthy' : 'Unhealthy'}
                      >
                        <span
                          className={clsx('h-1.5 w-1.5 rounded-full', isHealthy ? 'bg-green-500' : 'bg-red-500')}
                          aria-hidden="true"
                        />
                        {isHealthy ? 'Healthy' : w.health?.error ? `Unhealthy: ${w.health.error}` : 'Unhealthy'}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{w.jobsProcessed}</Td>
                    <Td className="text-right tabular-nums">{w.jobsFailed}</Td>
                    <Td className="text-right tabular-nums">{formatMs(w.averageProcessingTime)}</Td>
                    <Td className="text-right tabular-nums" title={new Date(w.lastActivity).toLocaleString()}>
                      {timeAgo(w.lastActivity)}
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleAction('remove', w.workerId)}
                        loading={actionLoading === removeKey}
                        aria-label={`Remove ${w.workerId}`}
                      >
                        Remove
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-xs text-gray-500">
        Last updated: {data ? new Date().toLocaleTimeString() : '—'}
      </footer>
    </main>
  );
}

const Th = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <th
    scope="col"
    className={clsx('px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600', className)}
  >
    {children}
  </th>
);

const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <td className={clsx('px-4 py-3 text-sm text-gray-700', className)}>{children}</td>
);

const StatCard = ({ label, value }: { label: string; value: number | string }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4" role="group" aria-label={label}>
    <div className="text-xs font-medium text-gray-500">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
  </div>
);

