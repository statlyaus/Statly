-- Statly: web vitals table for METRICS_BACKEND=clickhouse
-- Apply in the target database before enabling the ClickHouse metrics writer.
--
-- Ordering and types follow ClickHouse best-practices guidance:
-- Per schema-pk-cardinality-order / schema-pk-prioritize-filters: lead with coarse date,
-- then low-cardinality metric name, then event time for time-range + metric dashboards.
-- Per schema-types-lowcardinality: enum-like string columns use LowCardinality(String).
-- Per schema-partition-lifecycle / schema-partition-low-cardinality: monthly partitions
-- for retention (TTL) and manageable partition count.
-- Per schema-types-avoid-nullable: nav_type uses DEFAULT '' instead of Nullable where possible.
--
-- If you already have a web_vitals table with a different ORDER BY, plan a migration
-- (ORDER BY cannot be changed in place; may require INSERT … SELECT into a new table).

CREATE TABLE IF NOT EXISTS web_vitals (
  ts DateTime64(3, 'Australia/Sydney'),
  name LowCardinality(String),
  value Float64,
  rating LowCardinality(String),
  delta Nullable(Float64),
  id String,
  nav_type LowCardinality(String) DEFAULT '',
  url String,
  user_agent String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (toDate(ts), name, ts)
TTL ts + INTERVAL 400 DAY
SETTINGS index_granularity = 8192;

-- Optional: if you frequently filter by URL prefix and need faster pruning, consider a
-- data-skipping index (per query-index-skipping-indices). Example (tune parameters for your data):
-- ALTER TABLE web_vitals ADD INDEX idx_url url TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4;
