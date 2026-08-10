ALTER TABLE "outcome_promotion_backed_corpus"
  DROP CONSTRAINT "outcome_promotion_backed_corpus_identity_check";

ALTER TABLE "outcome_promotion_backed_corpus"
  ADD CONSTRAINT "outcome_promotion_backed_corpus_identity_check" CHECK (
    "corpus_id" = 'corpus:' || "corpus_sha256"
    AND encode(sha256(convert_to("corpus_canonical_json",'UTF8')),'hex') = "corpus_sha256"
    AND "corpus_canonical_json"::jsonb = "corpus_json"->'content'
    AND encode(sha256(convert_to("member_set_canonical_json",'UTF8')),'hex') = "member_set_sha256"
    AND jsonb_typeof("member_set_canonical_json"::jsonb) = 'array'
  );
