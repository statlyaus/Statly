-- Permit the fixed private-evaluation coordinator to reauthenticate the exact
-- canonical-promotion ancestry at dataset admission and model-run start.
GRANT SELECT ("lineage_id", "candidate_id", "lineage_json")
ON "outcome_corpus_factual_lineage" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("candidate_id", "candidate_sha256", "status", "finalized_at", "candidate_json")
ON "outcome_factual_release_candidate" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT (
  "spell_version_id", "spell_id", "player_id", "club_id", "start_event_version_id",
  "start_asset_version_id"
) ON "outcome_acquisition_spell_version" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("event_version_id", "event_id", "source_import_row_id", "status")
ON "outcome_event_version" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("event_id", "competition", "season_year")
ON "outcome_event" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT (
  "asset_version_id", "event_version_id", "player_id", "to_club_id", "source_import_row_id",
  "status"
) ON "outcome_event_asset" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("import_row_id", "import_run_id", "parse_status")
ON "outcome_import_row" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("import_run_id", "capture_id", "import_kind", "status")
ON "outcome_import_run" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("import_run_id", "capture_id", "promotion_id")
ON "outcome_external_canonical_promotion_import_run"
TO afl_trade_private_evaluation_coordinator;
GRANT SELECT (
  "promotion_id", "candidate_id", "approval_decision_id", "environment", "competition",
  "status", "finalized_at"
) ON "outcome_external_canonical_promotion" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("promotion_id", "source_import_row_id", "canonical_record_id", "record_kind")
ON "outcome_external_canonical_promotion_record"
TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("candidate_id", "decision_id", "status")
ON "outcome_external_canonical_promotion_review_head"
TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ("edge_id", "event_id")
ON "outcome_pick_lineage_edge" TO afl_trade_private_evaluation_coordinator;

-- PostgreSQL row locks require UPDATE privilege. Limit it to immutable identity
-- columns; existing append-only and review-chain guards reject substantive mutation.
GRANT UPDATE ("lineage_id") ON "outcome_valuation_dataset_factual_lineage"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("lineage_id") ON "outcome_corpus_factual_lineage"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("candidate_id") ON "outcome_factual_release_candidate"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("promotion_id") ON "outcome_external_canonical_promotion"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("candidate_id") ON "outcome_external_canonical_promotion_review_head"
TO afl_trade_private_evaluation_coordinator;
