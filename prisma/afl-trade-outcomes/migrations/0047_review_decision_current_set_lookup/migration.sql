CREATE INDEX "outcome_review_decision_reviewer_subject_current_idx"
ON "outcome_review_decision" ("decided_by", "subject_type", "decision_id")
WHERE "decision" = 'approved';
