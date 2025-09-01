import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Sparkline } from './Sparkline';

type Metrics = {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  averageResponseTime: number;
  activeConnections: number;
  uptime: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
        ? 'bg-green-100 text-green-700 ring-1 ring-inset ring-green-200'
        : 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
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
        <h3 className="text-sm font-medium text-gray-700">Server Metrics</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${health.className}`}>
          {health.label}
        </span>
      </div>
      {error && <div className="text-sm text-red-600">Failed to load metrics</div>}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">Requests (1h)</dt>
          <dd className="font-medium text-gray-900">{data?.totalRequests ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Errors (1h)</dt>
          <dd className="font-medium text-gray-900">{data?.totalErrors ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Error Rate</dt>
          <dd className="font-medium text-gray-900">
            {formattedErrorRate != null ? `${formattedErrorRate}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Avg Latency</dt>
          <dd className="font-medium text-gray-900 flex items-center gap-2">
            {data?.averageResponseTime ? `${Math.round(data.averageResponseTime)} ms` : '—'}
            <Sparkline values={latencySamples} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
