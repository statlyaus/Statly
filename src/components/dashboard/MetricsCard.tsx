import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import useSWR from 'swr';

import { Sparkline } from './Sparkline';

type Metrics = {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  averageResponseTime: number;
  activeConnections: number;
  uptime: number;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    // Don't throw for 401/403 - just return null to indicate no data
    if (res.status === 401 || res.status === 403) {
      return null;
    }
    throw new Error(`Failed to fetch: ${res.statusText}`);
  }
  return res.json();
};

type MetricsCardProps = {
  errorRateThreshold?: number;
};

export default function MetricsCard({ errorRateThreshold = 2 }: MetricsCardProps): ReactElement {
  const { data, error } = useSWR<Metrics>('/api/metrics', fetcher, { refreshInterval: 30000 });
  const [latencySamples, setLatencySamples] = useState<number[]>([]);

  useEffect(() => {
    if (typeof data?.averageResponseTime === 'number') {
      setLatencySamples((prev) => {
        const next = [...prev, data.averageResponseTime];
        if (next.length > 24) next.shift();
        return next;
      });
    }
  }, [data?.averageResponseTime]);

  const health = useMemo(() => {
    const rate = data?.errorRate ?? 0;
    const healthy = rate <= errorRateThreshold;
    return {
      label: healthy ? 'Healthy' : 'Degraded',
      className: healthy
        ? 'bg-success/10 text-success ring-1 ring-inset ring-success'
        : 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive',
    };
  }, [data?.errorRate, errorRateThreshold]);

  const formattedErrorRate = useMemo(() => {
    const value = data?.errorRate;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round(value * 10) / 10;
    return String(rounded);
  }, [data?.errorRate]);

  return (
    <div className="rounded-lg bg-white px-6 py-5 shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">Server Metrics</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${health.className}`}>
          {health.label}
        </span>
      </div>
      {error && <div className="text-sm text-destructive">Failed to load metrics</div>}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Requests (1h)</dt>
          <dd className="font-medium text-foreground">{data?.totalRequests ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Errors (1h)</dt>
          <dd className="font-medium text-foreground">{data?.totalErrors ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Error Rate</dt>
          <dd className="font-medium text-foreground">
            {formattedErrorRate != null ? `${formattedErrorRate}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Avg Latency</dt>
          <dd className="font-medium text-foreground flex items-center gap-2">
            {data?.averageResponseTime ? `${Math.round(data.averageResponseTime)} ms` : '—'}
            <Sparkline values={latencySamples} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
