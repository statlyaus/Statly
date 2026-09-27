-- Current HPN input builds resolve each decoded row's home and away clubs by match candidate and
-- side. Without this index every lookup scanned the whole club-resolution table, so a genuine season
-- (about 20,000 rows) timed out after 30 minutes; with it the same read takes under a minute.
CREATE INDEX "outcome_provider_club_resolution_candidate_side_idx"
  ON "outcome_provider_club_resolution" ("match_candidate_id", "side");
