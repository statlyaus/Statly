'use server';

// Minimal Prometheus exposition without external deps.
// Counters are monotonic; gauges are computed on demand by caller.

type Labels = Record<string, string>;
type CounterMap = Map<string, number>; // key -> value where key includes labels

const counters: CounterMap = new Map();

function metricsEnabled(): boolean {
  // Default enabled; disable if explicitly set to 'false'
  const v = process.env.SOCKET_METRICS_ENABLED;
  if (typeof v === 'string') return v !== 'false';
  const dv = process.env.SOCKET_METRICS_DISABLED;
  if (typeof dv === 'string') return dv !== 'true';
  return true;
}

function labelsKey(labels?: Labels): string {
  if (!labels) return '';
  const parts = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return parts.join('|');
}

export function incCounter(name: string, value = 1, labels?: Labels): void {
  if (!metricsEnabled()) return;
  const key = `${name}#${labelsKey(labels)}`;
  counters.set(key, (counters.get(key) || 0) + value);
}

export function getCounter(name: string, labels?: Labels): number {
  const key = `${name}#${labelsKey(labels)}`;
  return counters.get(key) || 0;
}

export function renderPrometheus(metrics: Array<{ name: string; help?: string; type?: 'counter' | 'gauge'; value: number; labels?: Labels }>): string {
  const lines: string[] = [];
  const emittedType = new Set<string>();
  for (const m of metrics) {
    if (m.help) lines.push(`# HELP ${m.name} ${m.help}`);
    if (!emittedType.has(m.name)) {
      lines.push(`# TYPE ${m.name} ${m.type || 'counter'}`);
      emittedType.add(m.name);
    }
    const labelStr = m.labels && Object.keys(m.labels).length
      ? '{' + Object.entries(m.labels).map(([k,v]) => `${k}="${v.replace(/"/g,'\\"')}"`).join(',') + '}'
      : '';
    lines.push(`${m.name}${labelStr} ${Number.isFinite(m.value) ? m.value : 0}`);
  }
  // include all internal counters too
  for (const [fullKey, value] of counters.entries()) {
    const [name, raw] = fullKey.split('#');
    // skip if already explicitly rendered with same labels
    if (metrics.find((m) => m.name === name)) continue;
    const labels = raw
      ? '{' + raw.split('|').filter(Boolean).map(p => {
          const idx = p.indexOf('=');
          const k = idx >= 0 ? p.slice(0, idx) : p;
          const v = idx >= 0 ? p.slice(idx + 1) : '';
          return `${k}="${(v||'').replace(/"/g,'\\"')}"`;
        }).join(',') + '}'
      : '';
    if (!emittedType.has(name)) {
      lines.push(`# TYPE ${name} counter`);
      emittedType.add(name);
    }
    lines.push(`${name}${labels} ${value}`);
  }
  return lines.join('\n') + '\n';
}

// Common metric names used in socketioServer
export const METRICS = {
  connections: 'socketio_connections_total',
  joins: 'socketio_joins_total',
  leaves: 'socketio_leaves_total',
  rateLimitRejections: 'socketio_rate_limit_rejections_total',
  authFailures: 'socketio_auth_failures_total',
  timerTicks: 'socketio_timer_ticks_total',
  timerExpired: 'socketio_timer_expired_total',
  picksHandled: 'socketio_picks_handled_total',
  pickFailures: 'socketio_pick_failures_total',
  leadershipAcquired: 'socketio_timer_leadership_acquired_total',
  leadershipLost: 'socketio_timer_leadership_lost_total',
};

// Optional histogram support (basic), with labeled series
type HistogramSeries = {
  buckets: number[]; // sorted bucket upper bounds
  counts: number[]; // cumulative bucket counts
  sum: number;
  count: number;
};

const histograms: Map<string, Map<string, HistogramSeries>> = new Map(); // name -> labelKey -> series
const histogramBuckets: Map<string, number[]> = new Map();

export function registerHistogram(name: string, buckets: number[]): void {
  histogramBuckets.set(name, [...buckets].sort((a,b)=>a-b));
}

export function observeHistogram(name: string, value: number, labels?: Labels): void {
  if (!metricsEnabled()) return;
  const buckets = histogramBuckets.get(name);
  if (!buckets) return; // not registered
  const key = labelsKey(labels);
  let seriesMap = histograms.get(name);
  if (!seriesMap) {
    seriesMap = new Map();
    histograms.set(name, seriesMap);
  }
  let s = seriesMap.get(key);
  if (!s) {
    s = { buckets: buckets, counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
    seriesMap.set(key, s);
  }
  // find bucket index
  let idx = buckets.findIndex(b => value <= b);
  if (idx === -1) idx = buckets.length; // +Inf bucket (do not increment finite buckets)
  for (let i = idx; i < s.counts.length; i++) {
    // cumulative increments: Prom histogram expects cumulative per-le bucket
    s.counts[i] += 1;
  }
  s.sum += value;
  s.count += 1;
}

export function renderHistograms(): string {
  const lines: string[] = [];
  for (const [name, seriesMap] of histograms.entries()) {
    lines.push(`# TYPE ${name} histogram`);
    for (const [labelKey, s] of seriesMap.entries()) {
      const baseLabels = labelKey
        ? '{' + labelKey.split('|').filter(Boolean).map(p => {
            const idx = p.indexOf('=');
            const k = idx >= 0 ? p.slice(0, idx) : p;
            const v = idx >= 0 ? p.slice(idx + 1) : '';
            return `${k}="${(v||'').replace(/"/g,'\\"')}"`;
          }).join(',') + '}'
        : '';
      for (let i = 0; i < s.buckets.length; i++) {
        const le = s.buckets[i];
        lines.push(`${name}_bucket${baseLabels ? baseLabels.replace('}', `,le="${le}"}`) : `{le="${le}"}`} ${s.counts[i]}`);
      }
      // +Inf bucket is equal to total count
      lines.push(`${name}_bucket${baseLabels ? baseLabels.replace('}', `,le="+Inf"}`) : `{le="+Inf"}`} ${s.count}`);
      lines.push(`${name}_sum${baseLabels} ${s.sum}`);
      lines.push(`${name}_count${baseLabels} ${s.count}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
