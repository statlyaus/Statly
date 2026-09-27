-- Deployment conditions: the only target is the owner's single-user local outcomes database,
-- migrated with `prisma migrate deploy` while no club-resolution writer is running. The plain
-- (non-concurrent) build blocks writes to this table only while it runs: measured at 1.5 s on the
-- genuine table (60,048 rows, 335 MB). CONCURRENTLY is not used because the runner applies each
-- migration inside a transaction. Recovery: a failed build rolls back with its migration, so no
-- index is left behind; mark it `prisma migrate resolve --rolled-back` and deploy again.
--
-- Current HPN input builds resolve each decoded row's home and away clubs by match candidate and
-- side. Without this index every lookup scanned the whole club-resolution table, so a genuine season
-- (about 20,000 rows) timed out after 30 minutes; with it the same read takes under a minute.
CREATE INDEX "outcome_provider_club_resolution_candidate_side_idx"
  ON "outcome_provider_club_resolution" ("match_candidate_id", "side");
