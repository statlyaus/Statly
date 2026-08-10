ALTER TABLE "outcome_external_canonical_promotion"
  DROP CONSTRAINT "outcome_external_canonical_promotion_json_check";

ALTER TABLE "outcome_external_canonical_promotion"
  ADD CONSTRAINT "outcome_external_canonical_promotion_json_check" CHECK (
    encode(sha256(convert_to("proposal_canonical_json", 'UTF8')), 'hex') = "proposal_sha256"
    AND "proposal_canonical_json"::jsonb = "proposal_json"->'content'
    AND encode(sha256(convert_to("receipt_canonical_json", 'UTF8')), 'hex') = "receipt_sha256"
    AND "receipt_canonical_json"::jsonb = "receipt_json"->'content'
    AND "proposal_json"->>'proposalId' = "proposal_id"
    AND "receipt_json"->>'promotionId' = "promotion_id"
    AND "receipt_json"->'content'->>'candidateId' = "candidate_id"
    AND "receipt_json"->'content'->>'proposalId' = "proposal_id"
    AND "receipt_json"->'content'->>'approvalDecisionId' = "approval_decision_id"
    AND "proposal_json"->'content'->>'publicationEligible' = 'false'
  );
