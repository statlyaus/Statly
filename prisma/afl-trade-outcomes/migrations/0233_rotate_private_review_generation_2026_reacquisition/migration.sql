-- Rotate the private historical review identity to the genuine 2026 re-acquisition generation.
-- The issue #574 capture session retained only ephemeral egress keys, so its generation digest
-- cannot be reproduced; the re-acquired five-season capture set is corpus-identical
-- (LOCAL_FIVE_SEASON_AFL_TABLES_CORPUS_SHA256 is unchanged) and admits the rotated digest below.
DO $migration$
DECLARE
  old_digest CONSTANT TEXT :=
    '41a90da56a0e682888d50f0e95e729af838f9103708eba50bffae82f33c4523b';
  new_digest CONSTANT TEXT :=
    '7d90b71f07c106b6131d5d36709bab89c55fda53daeeef3b17d84c87ef1832d4';
  function_signature TEXT;
  function_definition TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'outcome_private_reviewed_evidence_is_current()',
    'validate_outcome_private_reviewed_evidence_bundle_insert()',
    'outcome_private_reviewed_evidence_bundle_is_current_v1(text)'
  ]
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(function_signature))
      INTO function_definition;
    IF function_definition IS NULL
       OR position(old_digest IN function_definition)=0
       OR position(new_digest IN function_definition)>0
    THEN
      RAISE EXCEPTION 'Private review currentness function % has unexpected lineage',
        function_signature;
    END IF;
    EXECUTE replace(function_definition,old_digest,new_digest);
  END LOOP;
END $migration$;

DROP INDEX "outcome_review_decision_private_set_current_idx";
CREATE INDEX "outcome_review_decision_private_set_current_idx"
  ON "outcome_review_decision"(
    ("evidence_json"->>'evidenceSetSha256'),"decided_by","decision","subject_type"
  )
  WHERE "evidence_json"->>'evidenceSetSha256' IN (
    'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
    '7ef741add1ae94133c597581f8a2175118058bedd2ffe8a107213630e1b0fd10',
    '41a90da56a0e682888d50f0e95e729af838f9103708eba50bffae82f33c4523b',
    '7d90b71f07c106b6131d5d36709bab89c55fda53daeeef3b17d84c87ef1832d4',
    '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
  );

CREATE OR REPLACE FUNCTION "reject_outcome_private_review_set_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    OLD."decided_by" IN (
      'local-five-season-evidence-reviewer',
      'local-workbook-evidence-reviewer'
    )
    AND OLD."evidence_json"->>'evidenceSetSha256' IN (
      'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
      '7ef741add1ae94133c597581f8a2175118058bedd2ffe8a107213630e1b0fd10',
      '41a90da56a0e682888d50f0e95e729af838f9103708eba50bffae82f33c4523b',
      '7d90b71f07c106b6131d5d36709bab89c55fda53daeeef3b17d84c87ef1832d4',
      '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
    )
  ) THEN
    RAISE EXCEPTION 'Admitted private review-set decisions are append-only';
  END IF;
  RETURN OLD;
END $$;
