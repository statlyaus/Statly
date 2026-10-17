import { describe, expect, it } from 'vitest';

import {
  getCounter,
  incCounter,
  observeHistogram,
  registerHistogram,
  renderHistograms,
  renderPrometheus,
} from '@/server/metrics';

describe('metrics exposition', () => {
  it('renders internal counters that share a name with an explicit metric but not its labels', () => {
    incCounter('exposition_shared_name_total', 1, { shard: '2' });

    const output = renderPrometheus([
      { name: 'exposition_shared_name_total', value: 5, labels: { shard: '1' }, type: 'counter' },
    ]);

    expect(output).toContain('exposition_shared_name_total{shard="1"} 5');
    expect(output).toContain('exposition_shared_name_total{shard="2"} 1');
  });

  it('keeps label values that contain the old separator characters intact', () => {
    incCounter('exposition_separator_total', 1, { r: 'a|b=c' });

    expect(renderPrometheus([])).toContain('exposition_separator_total{r="a|b=c"} 1');
    expect(getCounter('exposition_separator_total', { r: 'a|b=c' })).toBe(1);
  });

  it('keeps a hash inside a label value and skips only explicit series with the same labels', () => {
    incCounter('exposition_hash_total', 2, { route: '/a#b' });
    incCounter('exposition_hash_total', 3, { route: '/other' });

    const output = renderPrometheus([
      { name: 'exposition_hash_total', value: 9, labels: { route: '/other' }, type: 'counter' },
    ]);

    expect(output).toContain('exposition_hash_total{route="/a#b"} 2');
    expect(output).toContain('exposition_hash_total{route="/other"} 9');
    expect(output).not.toContain('exposition_hash_total{route="/other"} 3');
  });

  it('keeps histogram label values that contain separator characters intact', () => {
    registerHistogram('exposition_histogram_seconds', [1]);
    observeHistogram('exposition_histogram_seconds', 0.5, { r: 'a|b=c' });

    const output = renderHistograms();

    expect(output).toContain('exposition_histogram_seconds_bucket{r="a|b=c",le="1"} 1');
    expect(output).toContain('exposition_histogram_seconds_count{r="a|b=c"} 1');
  });
});
