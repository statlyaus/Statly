GRANT SELECT ON
  "outcome_pick_pav_policy",
  "outcome_pick_pav_selection_access",
  "outcome_review_decision",
  "outcome_active_release",
  "outcome_release_manifest",
  "outcome_release_draft_selection",
  "outcome_draft_selection",
  "outcome_draft_pick",
  "outcome_event_version",
  "outcome_event",
  "outcome_hpn_pav_calculation",
  "outcome_hpn_pav_calculation_head",
  "outcome_hpn_pav_calculation_team",
  "outcome_hpn_pav_calculation_player",
  "outcome_valuation_dataset_candidate",
  "outcome_valuation_dataset_admission",
  "outcome_valuation_model_protocol",
  "outcome_artifact_custody",
  "outcome_pick_pav_observation_set",
  "outcome_pick_pav_calculation_member",
  "outcome_pick_pav_draft_class",
  "outcome_pick_pav_observation",
  "outcome_pick_pav_observation_calculation",
  "outcome_pick_pav_player_value"
TO afl_trade_private_evaluation_coordinator;

GRANT INSERT ON
  "outcome_pick_pav_observation_set",
  "outcome_pick_pav_calculation_member",
  "outcome_pick_pav_draft_class",
  "outcome_pick_pav_observation",
  "outcome_pick_pav_observation_calculation",
  "outcome_pick_pav_player_value"
TO afl_trade_private_evaluation_coordinator;

-- Dispatch-bound trigger fences in 0079 authenticate these inserts against the
-- live request claim and the exact retained operation ancestry.
GRANT INSERT ON
  "outcome_governed_pick_pav_model_execution",
  "outcome_governed_valuation_component_run"
TO afl_trade_private_evaluation_coordinator;

-- PostgreSQL row-locking clauses require UPDATE privilege even for FOR SHARE.
-- Limit that capability to immutable identity columns guarded by the retained-authority triggers.
GRANT UPDATE ("policy_id") ON "outcome_pick_pav_policy"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("decision_id") ON "outcome_pick_pav_selection_access"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("decision_id") ON "outcome_review_decision"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("scope_key") ON "outcome_active_release"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("release_id") ON "outcome_release_manifest"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("release_id") ON "outcome_release_draft_selection"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("selection_id") ON "outcome_draft_selection"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("event_version_id") ON "outcome_event_version"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("event_id") ON "outcome_event"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("calculation_id") ON "outcome_hpn_pav_calculation"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("calculation_id") ON "outcome_hpn_pav_calculation_head"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("dataset_id") ON "outcome_valuation_dataset_candidate"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("admission_id") ON "outcome_valuation_dataset_admission"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("protocol_id") ON "outcome_valuation_model_protocol"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("artifact_id") ON "outcome_artifact_custody"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("observation_set_id", "status", "finalized_at")
ON "outcome_pick_pav_observation_set"
TO afl_trade_private_evaluation_coordinator;
