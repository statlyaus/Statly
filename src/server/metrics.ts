// Metrics utilities for server-side monitoring

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

// JSON keeps label names and values unambiguous, whatever characters they contain.
function labelsKey(labels?: Labels): string {
  if (!labels) return '';
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length ? JSON.stringify(entries) : '';
}

function parseLabelsKey(key: string): Labels {
  if (!key) return {};
  return Object.fromEntries(JSON.parse(key) as Array<[string, string]>);
}

// Metric names never contain '#', but label values may, so only the first '#' separates them.
function splitSeriesKey(fullKey: string): { name: string; labelKey: string } {
  const hash = fullKey.indexOf('#');
  return { name: fullKey.slice(0, hash), labelKey: fullKey.slice(hash + 1) };
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

export function renderPrometheus(
  metrics: Array<{
    name: string;
    help?: string;
    type?: 'counter' | 'gauge';
    value: number;
    labels?: Labels;
  }>
): string {
  const lines: string[] = [];
  const emittedType = new Set<string>();
  for (const m of metrics) {
    if (m.help) lines.push(`# HELP ${m.name} ${m.help}`);
    if (!emittedType.has(m.name)) {
      lines.push(`# TYPE ${m.name} ${m.type || 'counter'}`);
      emittedType.add(m.name);
    }
    const labelStr =
      m.labels && Object.keys(m.labels).length
        ? '{' +
          Object.entries(m.labels)
            .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
            .join(',') +
          '}'
        : '';
    lines.push(`${m.name}${labelStr} ${Number.isFinite(m.value) ? m.value : 0}`);
  }
  // include all internal counters too
  for (const [fullKey, value] of counters.entries()) {
    const { name, labelKey } = splitSeriesKey(fullKey);
    // skip only the series already rendered explicitly with the same labels
    if (metrics.some((m) => m.name === name && labelsKey(m.labels) === labelKey)) continue;
    const parsed = parseLabelsKey(labelKey);
    const labels = Object.keys(parsed).length
      ? '{' +
        Object.entries(parsed)
          .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
          .join(',') +
        '}'
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
  draftClockConvergence: 'draft_clock_convergence_total',
  draftOutboxFlushes: 'draft_outbox_flushes_total',
  draftOutboxEvents: 'draft_outbox_events_total',
  draftRealtimeStatePreparationRetries: 'draft_realtime_state_preparation_retries_total',
  draftRealtimeV2Joins: 'draft_realtime_v2_joins_total',
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
  histogramBuckets.set(
    name,
    [...buckets].sort((a, b) => a - b)
  );
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
  let idx = buckets.findIndex((b) => value <= b);
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
      const parsed = parseLabelsKey(labelKey);
      const baseLabels = Object.keys(parsed).length
        ? '{' +
          Object.entries(parsed)
            .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
            .join(',') +
          '}'
        : '';
      for (let i = 0; i < s.buckets.length; i++) {
        const le = s.buckets[i];
        lines.push(
          `${name}_bucket${baseLabels ? baseLabels.replace('}', `,le="${le}"}`) : `{le="${le}"}`} ${s.counts[i]}`
        );
      }
      // +Inf bucket is equal to total count
      lines.push(
        `${name}_bucket${baseLabels ? baseLabels.replace('}', `,le="+Inf"}`) : `{le="+Inf"}`} ${s.count}`
      );
      lines.push(`${name}_sum${baseLabels} ${s.sum}`);
      lines.push(`${name}_count${baseLabels} ${s.count}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

registerHistogram('draft_realtime_v2_baseline_attempts', [1, 2, 3]);
registerHistogram('draft_realtime_v2_replay_events', [0, 1, 5, 10, 25, 50, 100, 250]);
