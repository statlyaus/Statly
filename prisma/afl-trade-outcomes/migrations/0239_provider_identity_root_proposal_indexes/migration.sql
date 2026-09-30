-- Deployment conditions: the only target is the owner's single-user local outcomes database,
-- migrated with `prisma migrate deploy` while no provider-resolution writer is running. The plain
-- (non-concurrent) builds block writes to outcome_provider_resolution_proposal only while they run:
-- measured at under 2.5 s together on the genuine table (about 111,000 rows, 480 MB). CONCURRENTLY
-- is not used because the runner applies each migration inside a transaction. Recovery: a failed
-- build rolls back with its migration, so no index is left behind; mark it
-- `prisma migrate resolve --rolled-back` and deploy again.
--
-- validate_outcome_provider_identity_root (0004) fires BEFORE INSERT on every approved reusable
-- resolution, including the ON CONFLICT no-op inserts that re-bind an existing identity root. Each
-- firing proves the root equals a staged proposal by looking the proposal up through its proposed
-- target. None of those lookups had an index, so every club-alias, player-identity and
-- match-identity decision scanned the whole proposal table (about 2 s each on the genuine table),
-- which makes a full season of about 110,000 per-occurrence decisions take days. With these
-- indexes the same lookups take a few milliseconds. The validated predicate is unchanged.
CREATE INDEX "outcome_provider_resolution_proposal_alias_target_idx"
  ON "outcome_provider_resolution_proposal" ((("proposal_json" -> 'proposedTarget') ->> 'aliasId'))
  WHERE "subject_type" = 'provider_club_candidate';

CREATE INDEX "outcome_provider_resolution_proposal_club_identity_target_idx"
  ON "outcome_provider_resolution_proposal" ((("proposal_json" -> 'proposedTarget') ->> 'clubIdentityId'))
  WHERE "subject_type" = 'provider_club_candidate';

CREATE INDEX "outcome_provider_resolution_proposal_player_identity_target_idx"
  ON "outcome_provider_resolution_proposal" ((("proposal_json" -> 'proposedTarget') ->> 'playerIdentityId'))
  WHERE "subject_type" = 'provider_player_candidate';

CREATE INDEX "outcome_provider_resolution_proposal_match_candidate_idx"
  ON "outcome_provider_resolution_proposal" ("match_candidate_id");
