CREATE TABLE "outcome_private_evaluation_batch" (
  "batch_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "prepared_input_set_revision" INTEGER NOT NULL CHECK ("prepared_input_set_revision">0),
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "model_qualification_id" TEXT NOT NULL REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id") ON DELETE RESTRICT,
  "model_qualification_work_id" TEXT NOT NULL REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT,
  "trade_count" INTEGER NOT NULL CHECK ("trade_count">0),
  "ready_count" INTEGER NOT NULL CHECK ("ready_count">=0),
  "unavailable_count" INTEGER NOT NULL CHECK ("unavailable_count">=0),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "content_sha256" CHAR(64) NOT NULL,
  "content_canonical_json" TEXT NOT NULL,
  "batch_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_evaluation_batch_id_check"
    CHECK ("batch_id" ~ '^private-evaluation-batch:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_private_evaluation_batch_counts_check"
    CHECK ("trade_count"="ready_count"+"unavailable_count")
);

CREATE TABLE "outcome_private_evaluation_batch_entry" (
  "batch_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
  "trade_id" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('ready','unavailable')),
  "generation_id" TEXT,
  "entry_json" JSONB NOT NULL,
  PRIMARY KEY ("batch_id","ordinal"),
  CONSTRAINT "outcome_private_evaluation_batch_entry_trade_key" UNIQUE ("batch_id","trade_id"),
  CONSTRAINT "outcome_private_evaluation_batch_entry_generation_consistency_check"
    CHECK (("state"='ready')=("generation_id" IS NOT NULL)),
  CONSTRAINT "outcome_private_evaluation_batch_entry_generation_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch"() RETURNS TRIGGER AS $$
DECLARE content JSONB; prepared RECORD; work RECORD; expected_ids JSONB;
  prepared_head RECORD; model_head RECORD; active_release RECORD;
BEGIN
  content:=NEW."batch_json"->'content';
  SELECT "scope_key","factual_release_scope_key","factual_release_id","trade_count","finalized_at"
    INTO prepared FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=NEW."prepared_input_set_id" FOR KEY SHARE;
  SELECT "scope_key","qualification_id" INTO work
    FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=NEW."model_qualification_work_id" FOR KEY SHARE;
  SELECT jsonb_agg(to_jsonb("trade_id") ORDER BY "trade_id") INTO expected_ids
    FROM "outcome_prepared_valuation_input_entry"
   WHERE "prepared_input_set_id"=NEW."prepared_input_set_id";
  SELECT * INTO prepared_head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO model_head FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO active_release FROM "outcome_active_release"
   WHERE "scope_key"=prepared."factual_release_scope_key" FOR KEY SHARE;
  IF prepared."finalized_at" IS NULL OR prepared."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     prepared."factual_release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     prepared."trade_count" IS DISTINCT FROM NEW."trade_count" OR
     work."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     work."qualification_id" IS DISTINCT FROM NEW."model_qualification_id" OR
     prepared_head."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id" OR
     prepared_head."revision" IS DISTINCT FROM NEW."prepared_input_set_revision" OR
     model_head."qualification_id" IS DISTINCT FROM NEW."model_qualification_id" OR
     model_head."work_id" IS DISTINCT FROM NEW."model_qualification_work_id" OR
     active_release."release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     NEW."created_at">transaction_timestamp() OR
     jsonb_typeof(NEW."batch_json")<>'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."batch_json"))<>2 OR
     NEW."batch_json"->>'batchId' IS DISTINCT FROM NEW."batch_id" OR
     jsonb_typeof(content)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(content))<>15 OR
     content->>'schemaVersion' IS DISTINCT FROM 'governed-private-evaluation-batch/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'preparedInputSetId' IS DISTINCT FROM NEW."prepared_input_set_id" OR
     (content->>'preparedInputSetRevision')::integer IS DISTINCT FROM NEW."prepared_input_set_revision" OR
     content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->>'modelQualificationId' IS DISTINCT FROM NEW."model_qualification_id" OR
     content->>'modelQualificationWorkId' IS DISTINCT FROM NEW."model_qualification_work_id" OR
     content->'entries' IS NULL OR jsonb_typeof(content->'entries')<>'array' OR
     (SELECT jsonb_agg(to_jsonb(entry->>'tradeId') ORDER BY ordinal)
        FROM jsonb_array_elements(content->'entries') WITH ORDINALITY supplied(entry,ordinal))
       IS DISTINCT FROM expected_ids OR
     jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count" OR
     (content->>'tradeCount')::integer IS DISTINCT FROM NEW."trade_count" OR
     (content->>'readyCount')::integer IS DISTINCT FROM NEW."ready_count" OR
     (content->>'unavailableCount')::integer IS DISTINCT FROM NEW."unavailable_count" OR
     (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
       WHERE entry->>'state'='ready') IS DISTINCT FROM NEW."ready_count" OR
     (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
       WHERE entry->>'state'='unavailable') IS DISTINCT FROM NEW."unavailable_count" OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(content->'entries') entry
        WHERE jsonb_typeof(entry)<>'object'
          OR jsonb_typeof(entry->'tradeId')<>'string'
          OR char_length(entry->>'tradeId') NOT BETWEEN 1 AND 400
          OR entry->>'tradeId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$'
          OR jsonb_typeof(entry->'state')<>'string'
          OR entry->>'state' NOT IN ('ready','unavailable')
          OR (entry->>'state'='ready' AND (
            (SELECT count(*) FROM jsonb_object_keys(entry))<>3
            OR jsonb_typeof(entry->'generationId')<>'string'
            OR entry->>'generationId' !~ '^local-private-trade-evaluation-generation:[a-f0-9]{64}$'
          ))
          OR (entry->>'state'='unavailable' AND (
            (SELECT count(*) FROM jsonb_object_keys(entry))<>3
            OR jsonb_typeof(entry->'blockers')<>'array'
            OR jsonb_array_length(entry->'blockers') NOT BETWEEN 1 AND 10000
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(entry->'blockers') blocker
               WHERE jsonb_typeof(blocker)<>'object'
                 OR (SELECT count(*) FROM jsonb_object_keys(blocker))<>2
                 OR jsonb_typeof(blocker->'code')<>'string'
                 OR blocker->>'code' NOT IN (
                   'source_blocked','insufficient_data','identity_unresolved','lineage_unresolved',
                   'model_not_approved','reconciliation_failed','engineering_unavailable',
                   'component_output_unavailable'
                 )
                 OR jsonb_typeof(blocker->'message')<>'string'
                 OR char_length(btrim(blocker->>'message')) NOT BETWEEN 1 AND 2000
                 OR blocker->>'message' IS DISTINCT FROM btrim(blocker->>'message')
            )
          ))
     ) OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->>'limitation' IS DISTINCT FROM
       'Private non-production evaluation batch only; it grants no factual, production, or publication authority.' OR
     NEW."content_canonical_json" IS DISTINCT FROM "outcome_afl_trade_canonical_json"(content) OR
     NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     NEW."batch_id" IS DISTINCT FROM 'private-evaluation-batch:'||encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Private evaluation batch identity or governed ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_batch_validate"
BEFORE INSERT ON "outcome_private_evaluation_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_batch"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_entry"() RETURNS TRIGGER AS $$
DECLARE parent RECORD; prepared_state TEXT; generation RECORD; snapshot JSONB; retained_entry JSONB;
BEGIN
  SELECT "scope_key","prepared_input_set_id","model_qualification_id",
         "model_qualification_work_id","batch_json" INTO parent
    FROM "outcome_private_evaluation_batch" WHERE "batch_id"=NEW."batch_id" FOR KEY SHARE;
  retained_entry:=parent."batch_json"->'content'->'entries'->NEW."ordinal";
  SELECT "state" INTO prepared_state FROM "outcome_prepared_valuation_input_entry"
   WHERE "prepared_input_set_id"=parent."prepared_input_set_id" AND "trade_id"=NEW."trade_id";
  IF NOT FOUND OR retained_entry IS NULL OR NEW."entry_json" IS DISTINCT FROM retained_entry OR
     retained_entry->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     retained_entry->>'state' IS DISTINCT FROM NEW."state" OR
     (NEW."state"='ready' AND prepared_state<>'ready') OR
     (NEW."state"='unavailable' AND
       (jsonb_typeof(NEW."entry_json"->'blockers')<>'array' OR jsonb_array_length(NEW."entry_json"->'blockers')=0)) THEN
    RAISE EXCEPTION 'Private evaluation batch entry does not match its prepared member';
  END IF;
  IF NEW."state"='ready' THEN
    SELECT g."valuation_scope_key",g."trade_id",g."generation_json",s."snapshot_json"
      INTO generation
      FROM "outcome_local_private_trade_evaluation_generation" g
      JOIN "outcome_private_evaluation_transition_intent" i ON i."transition_intent_id"=g."transition_intent_id"
      JOIN "outcome_private_evaluation_authority_snapshot" s ON s."snapshot_id"=i."authority_snapshot_id"
     WHERE g."generation_id"=NEW."generation_id" FOR KEY SHARE;
    snapshot:=generation."snapshot_json";
    IF generation."valuation_scope_key" IS DISTINCT FROM parent."scope_key" OR
       generation."trade_id" IS DISTINCT FROM NEW."trade_id" OR
       NEW."entry_json"->>'generationId' IS DISTINCT FROM NEW."generation_id" OR
       (generation."generation_json"->'content'->>'generatedAt')::timestamptz>
         (SELECT "created_at" FROM "outcome_private_evaluation_batch" WHERE "batch_id"=NEW."batch_id") OR
       snapshot->'content'->'calculationAuthority'->>'preparedInputSetId'
         IS DISTINCT FROM parent."prepared_input_set_id" OR
       snapshot->'content'->'calculationAuthority'->'components'->0->>'qualificationId'
         IS DISTINCT FROM parent."model_qualification_id" OR
       snapshot->'content'->'calculationAuthority'->'components'->1->>'qualificationId'
         IS DISTINCT FROM parent."model_qualification_id" OR
       NOT EXISTS (
         SELECT 1 FROM "outcome_governed_model_qualification_work" work
          WHERE work."work_id"=parent."model_qualification_work_id"
            AND work."qualification_id"=parent."model_qualification_id"
       ) OR
       "validate_outcome_automated_ready_calculation_authority"(
         snapshot->'content'->'calculationAuthority',parent."scope_key",NEW."trade_id"
       ) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Private evaluation batch generation is not exact current prepared authority';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_batch_entry_validate"
BEFORE INSERT ON "outcome_private_evaluation_batch_entry"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_batch_entry"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_evaluation_batch_mutation"() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Private evaluation batches are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_batch_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();
CREATE TRIGGER "outcome_private_evaluation_batch_entry_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_batch_entry"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE TABLE "outcome_private_evaluation_batch_transition" (
  "transition_id" TEXT PRIMARY KEY,
  "operation_id" TEXT NOT NULL UNIQUE,
  "scope_key" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL CHECK ("principal_id"='system:weekly-valuation-coordinator'),
  "action" TEXT NOT NULL CHECK ("action" IN ('activate','rollback')),
  "from_revision" INTEGER NOT NULL CHECK ("from_revision">=0),
  "from_batch_id" TEXT REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "to_revision" INTEGER NOT NULL CHECK ("to_revision">0),
  "to_batch_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "transitioned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_evaluation_batch_transition_revision_check"
    CHECK ("to_revision"="from_revision"+1),
  CONSTRAINT "outcome_private_evaluation_batch_transition_id_check"
    CHECK ("transition_id" ~ '^private-evaluation-batch-transition:[a-f0-9]{64}$')
);

CREATE TABLE "outcome_current_private_evaluation_batch" (
  "scope_key" TEXT PRIMARY KEY,
  "batch_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision">0),
  "last_transition_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch_transition"("transition_id") ON DELETE RESTRICT,
  "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp()
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_complete"(
  requested_scope_key TEXT, requested_batch_id TEXT
) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT COALESCE((
    SELECT
      (SELECT count(*) FROM "outcome_private_evaluation_batch_entry" entry
        WHERE entry."batch_id"=target."batch_id")=target."trade_count"
      AND (SELECT count(*) FROM "outcome_private_evaluation_batch_entry" entry
        WHERE entry."batch_id"=target."batch_id" AND entry."state"='ready')=target."ready_count"
      AND (SELECT count(*) FROM "outcome_private_evaluation_batch_entry" entry
        WHERE entry."batch_id"=target."batch_id" AND entry."state"='unavailable')=target."unavailable_count"
    FROM "outcome_private_evaluation_batch" target
    WHERE target."batch_id"=requested_batch_id AND target."scope_key"=requested_scope_key
  ),FALSE)
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_activation_target"(
  requested_scope_key TEXT, requested_batch_id TEXT
) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT COALESCE((
    SELECT "validate_outcome_private_evaluation_batch_complete"(
      requested_scope_key,requested_batch_id
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared_head
       WHERE prepared_head."scope_key"=target."scope_key"
         AND prepared_head."prepared_input_set_id"=target."prepared_input_set_id"
         AND prepared_head."revision"=target."prepared_input_set_revision"
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model_head
       WHERE model_head."scope_key"=target."scope_key"
         AND model_head."qualification_id"=target."model_qualification_id"
         AND model_head."work_id"=target."model_qualification_work_id"
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_prepared_valuation_input_set" prepared
      JOIN "outcome_active_release" active_release
        ON active_release."scope_key"=prepared."factual_release_scope_key"
       WHERE prepared."prepared_input_set_id"=target."prepared_input_set_id"
         AND active_release."release_id"=target."factual_release_id"
    )
    FROM "outcome_private_evaluation_batch" target
    WHERE target."batch_id"=requested_batch_id AND target."scope_key"=requested_scope_key
  ),FALSE)
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_transition"() RETURNS TRIGGER AS $$
DECLARE current_head RECORD; target_scope TEXT; expected_id TEXT;
BEGIN
  SELECT "scope_key" INTO target_scope FROM "outcome_private_evaluation_batch"
   WHERE "batch_id"=NEW."to_batch_id" FOR KEY SHARE;
  SELECT * INTO current_head FROM "outcome_current_private_evaluation_batch"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  expected_id:='private-evaluation-batch-transition:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'operationId',NEW."operation_id",'scopeKey',NEW."scope_key",'action',NEW."action",
      'principalId',NEW."principal_id",
      'fromRevision',NEW."from_revision",'fromBatchId',NEW."from_batch_id",
      'toRevision',NEW."to_revision",'toBatchId',NEW."to_batch_id"
    )),'UTF8')),'hex');
  IF target_scope IS NULL OR target_scope IS DISTINCT FROM NEW."scope_key" OR
     NEW."principal_id" IS DISTINCT FROM 'system:weekly-valuation-coordinator' OR
     NEW."operation_id" IS DISTINCT FROM 'private-evaluation-batch-operation:'||encode(sha256(convert_to(
       "outcome_afl_trade_canonical_json"(jsonb_build_object(
         'scopeKey',NEW."scope_key",'batchId',NEW."to_batch_id",
         'expectedRevision',NEW."from_revision",'action',NEW."action",
         'principalId',NEW."principal_id"
       )),'UTF8')),'hex') OR NEW."transition_id" IS DISTINCT FROM expected_id OR
     "validate_outcome_private_evaluation_batch_complete"(
       NEW."scope_key",NEW."to_batch_id"
     ) IS DISTINCT FROM TRUE OR
     (NEW."action"='activate' AND
       "validate_outcome_private_evaluation_batch_activation_target"(
         NEW."scope_key",NEW."to_batch_id"
       ) IS DISTINCT FROM TRUE) OR
     COALESCE(current_head."revision",0) IS DISTINCT FROM NEW."from_revision" OR
     current_head."batch_id" IS DISTINCT FROM NEW."from_batch_id" OR
     (NEW."action"='rollback' AND (
       NEW."from_batch_id" IS NULL OR NEW."from_batch_id"=NEW."to_batch_id" OR
       NOT EXISTS (
         SELECT 1 FROM "outcome_private_evaluation_batch_transition" prior_activation
          WHERE prior_activation."scope_key"=NEW."scope_key"
            AND prior_activation."to_batch_id"=NEW."to_batch_id"
       )
     )) THEN
    RAISE EXCEPTION 'Private evaluation batch transition is stale, cross-scope, or unauthenticated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_batch_transition_validate"
BEFORE INSERT ON "outcome_private_evaluation_batch_transition"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_batch_transition"();
CREATE TRIGGER "outcome_private_evaluation_batch_transition_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_batch_transition"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_current_private_evaluation_batch"() RETURNS TRIGGER AS $$
DECLARE transition RECORD;
BEGIN
  SELECT * INTO transition FROM "outcome_private_evaluation_batch_transition"
   WHERE "transition_id"=NEW."last_transition_id" FOR KEY SHARE;
  IF transition."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     transition."to_batch_id" IS DISTINCT FROM NEW."batch_id" OR
     transition."to_revision" IS DISTINCT FROM NEW."revision" OR
     (transition."action"='activate' AND
       "validate_outcome_private_evaluation_batch_activation_target"(
         NEW."scope_key",NEW."batch_id"
       ) IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Current private evaluation batch head target is not backed by its exact transition';
  END IF;
  IF TG_OP='INSERT' THEN
    IF transition."from_revision" IS DISTINCT FROM 0 OR transition."from_batch_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Current private evaluation batch initial head is not backed by its exact transition';
    END IF;
  ELSIF OLD."revision" IS DISTINCT FROM transition."from_revision" OR
        OLD."batch_id" IS DISTINCT FROM transition."from_batch_id" THEN
    RAISE EXCEPTION 'Current private evaluation batch predecessor is not backed by its exact transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_current_private_evaluation_batch_validate"
BEFORE INSERT OR UPDATE ON "outcome_current_private_evaluation_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_current_private_evaluation_batch"();
CREATE TRIGGER "outcome_current_private_evaluation_batch_no_delete"
BEFORE DELETE ON "outcome_current_private_evaluation_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ) AS $$
DECLARE current_head RECORD; target RECORD; retained RECORD; next_revision INTEGER; new_transition_id TEXT;
BEGIN
  IF requested_action NOT IN ('activate','rollback') OR expected_revision<0 OR
     requested_principal_id IS DISTINCT FROM 'system:weekly-valuation-coordinator' OR
     requested_operation_id IS DISTINCT FROM 'private-evaluation-batch-operation:'||encode(sha256(convert_to(
       "outcome_afl_trade_canonical_json"(jsonb_build_object(
         'scopeKey',requested_scope_key,'batchId',requested_batch_id,
         'expectedRevision',expected_revision,'action',requested_action,
         'principalId',requested_principal_id
       )),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Private evaluation batch transition request is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('private-evaluation-batch-head:'||requested_scope_key,0));
  SELECT target_row.* INTO target FROM "outcome_private_evaluation_batch" target_row
   WHERE target_row."batch_id"=requested_batch_id AND target_row."scope_key"=requested_scope_key FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private evaluation batch target is incomplete or cross-scope';
  END IF;
  SELECT * INTO retained FROM "outcome_private_evaluation_batch_transition"
   WHERE "operation_id"=requested_operation_id FOR KEY SHARE;
  IF FOUND THEN
    IF retained."scope_key" IS DISTINCT FROM requested_scope_key OR
       retained."to_batch_id" IS DISTINCT FROM requested_batch_id OR
       retained."action" IS DISTINCT FROM requested_action OR
       retained."principal_id" IS DISTINCT FROM requested_principal_id OR
       retained."from_revision" IS DISTINCT FROM expected_revision OR
       retained."to_revision" IS DISTINCT FROM expected_revision+1 THEN
      RAISE EXCEPTION 'Private evaluation batch operation replay is stale or conflicting';
    END IF;
    batch_id:=retained."to_batch_id";
    revision:=retained."to_revision";
    transition_id:=retained."transition_id";
    activated_at:=retained."transitioned_at";
    RETURN NEXT; RETURN;
  END IF;
  IF "validate_outcome_private_evaluation_batch_complete"(
       requested_scope_key,requested_batch_id
     ) IS DISTINCT FROM TRUE OR
     (requested_action='activate' AND
       "validate_outcome_private_evaluation_batch_activation_target"(
         requested_scope_key,requested_batch_id
       ) IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Private evaluation batch target is incomplete or cross-scope';
  END IF;
  SELECT * INTO current_head FROM "outcome_current_private_evaluation_batch"
   WHERE "scope_key"=requested_scope_key FOR UPDATE;
  IF COALESCE(current_head."revision",0)<>expected_revision OR
     (requested_action='rollback' AND (current_head."batch_id" IS NULL OR current_head."batch_id"=requested_batch_id OR
       NOT EXISTS (SELECT 1 FROM "outcome_private_evaluation_batch_transition" prior_activation
         WHERE prior_activation."scope_key"=requested_scope_key
           AND prior_activation."to_batch_id"=requested_batch_id))) THEN
    RAISE EXCEPTION 'Private evaluation batch heads require fenced compare-and-swap';
  END IF;
  next_revision:=expected_revision+1;
  new_transition_id:='private-evaluation-batch-transition:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'operationId',requested_operation_id,'scopeKey',requested_scope_key,'action',requested_action,
      'principalId',requested_principal_id,
      'fromRevision',expected_revision,'fromBatchId',current_head."batch_id",
      'toRevision',next_revision,'toBatchId',requested_batch_id
    )),'UTF8')),'hex');
  INSERT INTO "outcome_private_evaluation_batch_transition"
    ("transition_id","operation_id","scope_key","principal_id","action","from_revision","from_batch_id","to_revision","to_batch_id")
  VALUES (new_transition_id,requested_operation_id,requested_scope_key,requested_principal_id,requested_action,
          expected_revision,current_head."batch_id",next_revision,requested_batch_id);
  IF current_head."scope_key" IS NULL THEN
    INSERT INTO "outcome_current_private_evaluation_batch"
      ("scope_key","batch_id","revision","last_transition_id")
    VALUES (requested_scope_key,requested_batch_id,next_revision,new_transition_id);
  ELSE
    UPDATE "outcome_current_private_evaluation_batch" SET
      "batch_id"=requested_batch_id,"revision"=next_revision,
      "last_transition_id"=new_transition_id,"activated_at"=transaction_timestamp()
     WHERE "scope_key"=requested_scope_key;
  END IF;
  SELECT h."batch_id",h."revision",h."last_transition_id",h."activated_at"
    INTO batch_id,revision,transition_id,activated_at
    FROM "outcome_current_private_evaluation_batch" h WHERE h."scope_key"=requested_scope_key;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "outcome_private_evaluation_batch_withdrawal" (
  "withdrawal_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "trade_id" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id") ON DELETE RESTRICT,
  "principal_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "withdrawn_at" TIMESTAMPTZ(3) NOT NULL,
  "withdrawal_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_evaluation_batch_withdrawal_id_check"
    CHECK ("withdrawal_id" ~ '^private-evaluation-batch-withdrawal:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_private_evaluation_batch_withdrawal_trade_key" UNIQUE ("batch_id","trade_id")
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_withdrawal"() RETURNS TRIGGER AS $$
DECLARE entry RECORD; content JSONB; canonical TEXT; operator_authority_count INTEGER;
BEGIN
  SELECT b."scope_key",e."generation_id",e."state" INTO entry
    FROM "outcome_private_evaluation_batch" b JOIN "outcome_private_evaluation_batch_entry" e USING ("batch_id")
   WHERE b."batch_id"=NEW."batch_id" AND e."trade_id"=NEW."trade_id" FOR KEY SHARE;
  content:=NEW."withdrawal_json"->'content'; canonical:="outcome_afl_trade_canonical_json"(content);
  SELECT count(*) INTO operator_authority_count
    FROM "outcome_operational_principal_authority" authority
    JOIN "outcome_governed_evidence_reference" evidence
      ON evidence."reference_id"=authority."authority_evidence_id"
    JOIN "outcome_review_decision" approval
      ON approval."decision_id"=evidence."approval_decision_id"
     WHERE authority."principal_ref"=NEW."principal_id"
       AND authority."role"='afl_trade_private_evaluation_operator'
       AND authority."scope_key"=NEW."scope_key"
       AND authority."provider"='statly_modeling'
       AND authority."capability_id"='manage_private_trade_evaluation'
       AND authority."competition"='AFLM'
       AND authority."valid_from"<=NEW."withdrawn_at"
       AND (authority."valid_through" IS NULL OR authority."valid_through">NEW."withdrawn_at")
       AND authority."valid_from"<=transaction_timestamp()
       AND (authority."valid_through" IS NULL OR authority."valid_through">transaction_timestamp())
       AND evidence."environment"='test_fixture'::"OutcomeEnvironment"
       AND evidence."status"='approved'::"OutcomeRecordStatus"
       AND approval."decision"='approved'
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=approval."decision_id"
       );
  IF entry."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     entry."state" IS DISTINCT FROM 'ready' OR entry."generation_id" IS DISTINCT FROM NEW."generation_id" OR
     operator_authority_count IS DISTINCT FROM 1 OR NEW."withdrawn_at">transaction_timestamp() OR
     jsonb_typeof(NEW."withdrawal_json") IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."withdrawal_json"))<>2 OR
     NEW."withdrawal_json"->>'withdrawalId' IS DISTINCT FROM NEW."withdrawal_id" OR
     jsonb_typeof(content) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(content))<>11 OR
     content->>'schemaVersion' IS DISTINCT FROM 'governed-private-evaluation-batch-withdrawal/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'batchId' IS DISTINCT FROM NEW."batch_id" OR
     content->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     content->>'generationId' IS DISTINCT FROM NEW."generation_id" OR
     content->>'principalId' IS DISTINCT FROM NEW."principal_id" OR
     content->>'reason' IS DISTINCT FROM NEW."reason" OR
     char_length(btrim(content->>'principalId')) NOT BETWEEN 1 AND 400 OR
     content->>'principalId' IS DISTINCT FROM btrim(content->>'principalId') OR
     char_length(btrim(content->>'reason')) NOT BETWEEN 1 AND 2000 OR
     content->>'reason' IS DISTINCT FROM btrim(content->>'reason') OR
     (content->>'withdrawnAt')::timestamptz IS DISTINCT FROM NEW."withdrawn_at" OR
     content->>'limitation' IS DISTINCT FROM
       'Emergency private-reader suppression only; it does not alter factual, model, production, or publication authority.' OR
     NEW."withdrawal_id" IS DISTINCT FROM 'private-evaluation-batch-withdrawal:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Private evaluation batch withdrawal is not exact ready membership';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_batch_withdrawal_validate"
BEFORE INSERT ON "outcome_private_evaluation_batch_withdrawal"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_batch_withdrawal"();
CREATE TRIGGER "outcome_private_evaluation_batch_withdrawal_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_batch_withdrawal"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE INDEX "outcome_private_evaluation_batch_scope_created_idx"
  ON "outcome_private_evaluation_batch"("scope_key","created_at");
CREATE INDEX "outcome_private_evaluation_batch_entry_trade_idx"
  ON "outcome_private_evaluation_batch_entry"("trade_id","batch_id");

-- Harden the 0065 successor trigger without rewriting its applied migration: UPDATE
-- transitions have no prior lookup row, so their branch must never dereference one.
CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_head_transition"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE receipt RECORD; prior RECORD;
BEGIN
  SELECT * INTO receipt FROM "outcome_private_evaluation_transition_receipt"
   WHERE "transition_id"=NEW."last_transition_id" FOR KEY SHARE;
  IF receipt."transition_id" IS NULL OR
     receipt."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     receipt."trade_id" IS DISTINCT FROM NEW."trade_id" OR
     receipt."to_revision" IS DISTINCT FROM NEW."revision" OR
     receipt."to_status" IS DISTINCT FROM NEW."status" OR
     receipt."to_generation_id" IS DISTINCT FROM NEW."generation_id" THEN
    RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF receipt."from_revision" IS DISTINCT FROM OLD."revision" OR
       receipt."from_status" IS DISTINCT FROM OLD."status" OR
       receipt."from_generation_id" IS DISTINCT FROM OLD."generation_id" OR
       receipt."receipt_json"->'content'->>'previousTransitionId' IS DISTINCT FROM OLD."last_transition_id" THEN
      RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO prior FROM "outcome_local_private_trade_evaluation_head"
   WHERE "valuation_scope_key"=NEW."valuation_scope_key" AND "trade_id"=NEW."trade_id" FOR KEY SHARE;
  IF NOT FOUND THEN
    IF receipt."from_revision"<>0 OR receipt."from_status"<>'absent' OR
       receipt."from_generation_id" IS NOT NULL OR
       receipt."receipt_json"->'content'->>'previousTransitionId' IS NOT NULL THEN
      RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
    END IF;
  ELSIF receipt."from_revision" IS DISTINCT FROM prior."revision" OR
        receipt."from_status" IS DISTINCT FROM prior."status" OR
        receipt."from_generation_id" IS DISTINCT FROM prior."generation_id" OR
        receipt."receipt_json"->'content'->>'previousTransitionId' IS DISTINCT FROM prior."last_transition_id" THEN
    RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
  END IF;
  RETURN NEW;
END $$;
