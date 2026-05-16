import { describe, expect, it } from 'vitest';

import {
  buildClickHouseSessionSettings,
  defaultMetricsBatchSize,
  metricsBackend,
} from './webVitalsMetricsConfig';

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return partial as unknown as NodeJS.ProcessEnv;
}

describe('webVitalsMetricsConfig', () => {
  describe('metricsBackend', () => {
    it('defaults to firestore', () => {
      expect(metricsBackend(env({}))).toBe('firestore');
    });

    it('normalizes to lowercase', () => {
      expect(metricsBackend(env({ METRICS_BACKEND: 'ClickHouse' }))).toBe('clickhouse');
    });
  });

  describe('defaultMetricsBatchSize', () => {
    it('uses 50 for firestore when METRICS_BATCH_SIZE is unset', () => {
      expect(defaultMetricsBatchSize(env({ METRICS_BACKEND: 'firestore' }))).toBe(50);
    });

    it('uses 5000 for clickhouse when METRICS_BATCH_SIZE is unset', () => {
      expect(defaultMetricsBatchSize(env({ METRICS_BACKEND: 'clickhouse' }))).toBe(5000);
    });

    it('respects explicit METRICS_BATCH_SIZE for clickhouse', () => {
      expect(
        defaultMetricsBatchSize(env({ METRICS_BACKEND: 'clickhouse', METRICS_BATCH_SIZE: '12000' }))
      ).toBe(12000);
    });

    it('respects explicit METRICS_BATCH_SIZE for firestore', () => {
      expect(
        defaultMetricsBatchSize(env({ METRICS_BACKEND: 'firestore', METRICS_BATCH_SIZE: '100' }))
      ).toBe(100);
    });
  });

  describe('buildClickHouseSessionSettings', () => {
    it('enables durable async insert and session timezone', () => {
      const s = buildClickHouseSessionSettings('Australia/Sydney', env({}));
      expect(s).toEqual({
        session_timezone: 'Australia/Sydney',
        async_insert: 1,
        wait_for_async_insert: 1,
      });
    });

    it('adds optional async insert tuning when env vars are valid', () => {
      const s = buildClickHouseSessionSettings(
        'UTC',
        env({
          CLICKHOUSE_ASYNC_INSERT_MAX_DATA_SIZE: '10485760',
          CLICKHOUSE_ASYNC_INSERT_BUSY_TIMEOUT_MS: '750',
        })
      );
      expect(s.session_timezone).toBe('UTC');
      expect(s.async_insert).toBe(1);
      expect(s.wait_for_async_insert).toBe(1);
      expect(s.async_insert_max_data_size).toBe(10485760);
      expect(s.async_insert_busy_timeout_ms).toBe(750);
    });

    it('ignores non-positive or non-numeric async insert env values', () => {
      const s = buildClickHouseSessionSettings(
        'UTC',
        env({
          CLICKHOUSE_ASYNC_INSERT_MAX_DATA_SIZE: '0',
          CLICKHOUSE_ASYNC_INSERT_BUSY_TIMEOUT_MS: 'not-a-number',
        })
      );
      expect(s.async_insert_max_data_size).toBeUndefined();
      expect(s.async_insert_busy_timeout_ms).toBeUndefined();
    });
  });
});
