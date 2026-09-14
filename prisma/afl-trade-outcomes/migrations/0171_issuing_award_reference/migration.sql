-- Retrospective issuing references remain source evidence, not custody or draft-session facts.
ALTER TABLE outcome_external_evidence_row
  DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row
  ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK (claim_kind IN (
    'trade_detail_link','transaction','transaction_party','directed_transfer','draft_selection',
    'pick_custody','player_draft_detail','draft_session','draft_session_date',
    'draft_session_completion','draft_session_boundary','draft_completed_total',
    'issuing_award_reference'
  ));
