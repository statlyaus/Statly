CREATE TABLE "outcome_promotion_backed_corpus" (
  "corpus_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "anchor_season_from" INTEGER NOT NULL CHECK ("anchor_season_from" BETWEEN 1897 AND 2200),
  "anchor_season_through" INTEGER NOT NULL CHECK (
    "anchor_season_through" BETWEEN "anchor_season_from" AND 2200
  ),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "knowledge_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "promotion_count" INTEGER NOT NULL CHECK ("promotion_count" > 0),
  "member_count" INTEGER NOT NULL CHECK ("member_count" > 0),
  "member_set_sha256" CHAR(64) NOT NULL CHECK ("member_set_sha256" ~ '^[a-f0-9]{64}$'),
  "record_counts_json" JSONB NOT NULL CHECK (jsonb_typeof("record_counts_json") = 'object'),
  "corpus_sha256" CHAR(64) NOT NULL CHECK ("corpus_sha256" ~ '^[a-f0-9]{64}$'),
  "corpus_canonical_json" TEXT NOT NULL,
  "member_set_canonical_json" TEXT NOT NULL,
  "corpus_json" JSONB NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('open','finalized')),
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_promotion_backed_corpus_scope_cutoff_key"
    UNIQUE ("environment","competition","knowledge_cutoff_at"),
  CONSTRAINT "outcome_promotion_backed_corpus_identity_check" CHECK (
    "corpus_id" = 'corpus:' || "corpus_sha256"
    AND encode(sha256(convert_to("corpus_canonical_json",'UTF8')),'hex') = "corpus_sha256"
    AND "corpus_canonical_json"::jsonb = "corpus_json"
    AND encode(sha256(convert_to("member_set_canonical_json",'UTF8')),'hex') = "member_set_sha256"
    AND jsonb_typeof("member_set_canonical_json"::jsonb) = 'array'
  ),
  CONSTRAINT "outcome_promotion_backed_corpus_content_check" CHECK (
    "corpus_json"->>'corpusId' IS NOT DISTINCT FROM "corpus_id"
    AND "corpus_json"->'content'->>'schemaVersion'
      IS NOT DISTINCT FROM 'afl-trade-canonical-corpus/v3'
    AND "corpus_json"->'content'->>'environment' IS NOT DISTINCT FROM "environment"::text
    AND "corpus_json"->'content'->>'competition' IS NOT DISTINCT FROM "competition"
    AND ("corpus_json"->'content'->'anchorSeasonRange'->>'from')::integer
      IS NOT DISTINCT FROM "anchor_season_from"
    AND ("corpus_json"->'content'->'anchorSeasonRange'->>'through')::integer
      IS NOT DISTINCT FROM "anchor_season_through"
    AND ("corpus_json"->'content'->>'createdAt')::timestamptz IS NOT DISTINCT FROM "created_at"
    AND ("corpus_json"->'content'->>'knowledgeCutoffAt')::timestamptz
      IS NOT DISTINCT FROM "knowledge_cutoff_at"
    AND ("corpus_json"->'content'->>'promotionCount')::integer
      IS NOT DISTINCT FROM "promotion_count"
    AND ("corpus_json"->'content'->>'memberCount')::integer IS NOT DISTINCT FROM "member_count"
    AND "corpus_json"->'content'->>'memberSetSha256' IS NOT DISTINCT FROM "member_set_sha256"
    AND "corpus_json"->'content'->'recordCounts' IS NOT DISTINCT FROM "record_counts_json"
    AND "corpus_json"->'content'->>'publicationEligible' IS NOT DISTINCT FROM 'false'
    AND jsonb_typeof("corpus_json"->'content'->'promotions') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof("corpus_json"->'content'->'members') IS NOT DISTINCT FROM 'array'
  ),
  CONSTRAINT "outcome_promotion_backed_corpus_state_check" CHECK (
    "knowledge_cutoff_at" <= "created_at"
    AND (("status"='open' AND "finalized_at" IS NULL)
      OR ("status"='finalized' AND "finalized_at"="created_at"))
  )
);
CREATE INDEX "outcome_promotion_backed_corpus_scope_idx"
  ON "outcome_promotion_backed_corpus"("environment","competition","status","created_at");

CREATE TABLE "outcome_promotion_backed_corpus_promotion" (
  "corpus_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "promotion_id" TEXT NOT NULL,
  "promotion_sha256" CHAR(64) NOT NULL CHECK ("promotion_sha256" ~ '^[a-f0-9]{64}$'),
  "anchor_season_year" INTEGER NOT NULL CHECK ("anchor_season_year" BETWEEN 1897 AND 2200),
  "finalized_at" TIMESTAMPTZ(3) NOT NULL,
  "promotion_record_count" INTEGER NOT NULL CHECK ("promotion_record_count" > 0),
  PRIMARY KEY ("corpus_id","promotion_id"),
  CONSTRAINT "outcome_promotion_backed_corpus_promotion_ordinal_key"
    UNIQUE ("corpus_id","ordinal"),
  CONSTRAINT "outcome_promotion_backed_corpus_promotion_identity_check"
    CHECK ("promotion_id" = 'external-canonical-promotion:' || "promotion_sha256"),
  CONSTRAINT "outcome_promotion_backed_corpus_promotion_parent_fkey"
    FOREIGN KEY ("corpus_id") REFERENCES "outcome_promotion_backed_corpus"("corpus_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_promotion_backed_corpus_promotion_source_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "outcome_external_canonical_promotion"("promotion_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_promotion_backed_corpus_promotion_source_idx"
  ON "outcome_promotion_backed_corpus_promotion"("promotion_id","corpus_id");

CREATE TABLE "outcome_promotion_backed_corpus_member" (
  "corpus_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "promotion_id" TEXT NOT NULL,
  "record_kind" TEXT NOT NULL CHECK ("record_kind" IN (
    'transaction','transfer','draft_event','draft_selection','draft_player_asset',
    'pick_custody','pick_realization'
  )),
  "source_record_id" TEXT NOT NULL,
  "canonical_record_id" TEXT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL CHECK ("record_sha256" ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY ("corpus_id","promotion_id","record_kind","source_record_id"),
  CONSTRAINT "outcome_promotion_backed_corpus_member_ordinal_key" UNIQUE ("corpus_id","ordinal"),
  CONSTRAINT "outcome_promotion_backed_corpus_member_parent_fkey"
    FOREIGN KEY ("corpus_id") REFERENCES "outcome_promotion_backed_corpus"("corpus_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_promotion_backed_corpus_member_promotion_fkey"
    FOREIGN KEY ("corpus_id","promotion_id")
      REFERENCES "outcome_promotion_backed_corpus_promotion"("corpus_id","promotion_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_promotion_backed_corpus_member_record_fkey"
    FOREIGN KEY ("promotion_id","record_kind","source_record_id")
      REFERENCES "outcome_external_canonical_promotion_record"
        ("promotion_id","record_kind","source_record_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_promotion_backed_corpus_member_canonical_idx"
  ON "outcome_promotion_backed_corpus_member"("record_kind","canonical_record_id","corpus_id");

CREATE FUNCTION "lock_outcome_external_promotion_corpus_scope"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='open' AND NEW.status='finalized' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'outcome-promotion-corpus-scope:' || NEW.environment::text || ':' || NEW.competition,0
    ));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "aa_outcome_external_promotion_corpus_scope_lock"
BEFORE UPDATE ON "outcome_external_canonical_promotion"
FOR EACH ROW EXECUTE FUNCTION "lock_outcome_external_promotion_corpus_scope"();

CREATE FUNCTION "validate_outcome_promotion_backed_corpus_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-promotion-corpus-scope:' || NEW.environment::text || ':' || NEW.competition,0
  ));
  IF NEW.status<>'open' OR NEW.finalized_at IS NOT NULL OR NEW.created_at>statement_timestamp() THEN
    RAISE EXCEPTION 'Canonical corpus must be inserted open with non-future chronology';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_promotion_backed_corpus_insert_guard"
BEFORE INSERT ON "outcome_promotion_backed_corpus"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_promotion_backed_corpus_insert"();

CREATE FUNCTION "guard_outcome_promotion_backed_corpus_promotion_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent RECORD; promotion RECORD;
BEGIN
  SELECT * INTO parent FROM outcome_promotion_backed_corpus
   WHERE corpus_id=NEW.corpus_id FOR SHARE;
  IF NOT FOUND OR parent.status<>'open' THEN
    RAISE EXCEPTION 'Corpus promotion membership requires an open corpus';
  END IF;
  SELECT * INTO promotion FROM outcome_external_canonical_promotion
   WHERE promotion_id=NEW.promotion_id FOR SHARE;
  IF NOT FOUND OR promotion.status<>'finalized' OR promotion.finalized_at IS NULL
     OR promotion.environment<>parent.environment OR promotion.competition<>parent.competition
     OR promotion.anchor_season_year<>NEW.anchor_season_year
     OR promotion.finalized_at<>NEW.finalized_at
     OR promotion.receipt_sha256<>NEW.promotion_sha256
     OR promotion.promotion_record_count<>NEW.promotion_record_count
     OR promotion.finalized_at>parent.knowledge_cutoff_at THEN
    RAISE EXCEPTION 'Corpus promotion membership must match one exact eligible finalized promotion';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_promotion_backed_corpus_promotion_insert_guard"
BEFORE INSERT ON "outcome_promotion_backed_corpus_promotion"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_promotion_backed_corpus_promotion_insert"();

CREATE FUNCTION "guard_outcome_promotion_backed_corpus_member_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT; source_record RECORD;
BEGIN
  SELECT status INTO parent_status FROM outcome_promotion_backed_corpus
   WHERE corpus_id=NEW.corpus_id FOR SHARE;
  IF NOT FOUND OR parent_status<>'open' THEN
    RAISE EXCEPTION 'Canonical corpus members require an open corpus';
  END IF;
  SELECT record.canonical_record_id,record.record_sha256 INTO source_record
    FROM outcome_external_canonical_promotion_record record
   WHERE record.promotion_id=NEW.promotion_id AND record.record_kind=NEW.record_kind
     AND record.source_record_id=NEW.source_record_id FOR SHARE;
  IF NOT FOUND OR source_record.canonical_record_id<>NEW.canonical_record_id
     OR source_record.record_sha256<>NEW.record_sha256 THEN
    RAISE EXCEPTION 'Canonical corpus member must match its exact promotion record';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_promotion_backed_corpus_member_insert_guard"
BEFORE INSERT ON "outcome_promotion_backed_corpus_member"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_promotion_backed_corpus_member_insert"();

CREATE FUNCTION "finalize_outcome_promotion_backed_corpus"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE promotion_gap_count INTEGER; actual_promotion_count INTEGER; actual_member_count INTEGER;
DECLARE invalid_promotion_count INTEGER; invalid_member_count INTEGER;
DECLARE actual_promotions JSONB; actual_members JSONB; actual_member_set JSONB;
DECLARE actual_record_counts JSONB;
BEGIN
  IF OLD.status<>'open' OR NEW.status<>'finalized' OR NEW.finalized_at<>NEW.created_at
     OR NEW.corpus_id<>OLD.corpus_id OR NEW.environment<>OLD.environment
     OR NEW.competition<>OLD.competition OR NEW.anchor_season_from<>OLD.anchor_season_from
     OR NEW.anchor_season_through<>OLD.anchor_season_through OR NEW.created_at<>OLD.created_at
     OR NEW.knowledge_cutoff_at<>OLD.knowledge_cutoff_at
     OR NEW.promotion_count<>OLD.promotion_count OR NEW.member_count<>OLD.member_count
     OR NEW.member_set_sha256<>OLD.member_set_sha256
     OR NEW.record_counts_json<>OLD.record_counts_json OR NEW.corpus_sha256<>OLD.corpus_sha256
     OR NEW.corpus_canonical_json<>OLD.corpus_canonical_json
     OR NEW.member_set_canonical_json<>OLD.member_set_canonical_json
     OR NEW.corpus_json<>OLD.corpus_json THEN
    RAISE EXCEPTION 'Canonical corpus update must be its exact finalization transition';
  END IF;

  WITH eligible_promotions AS (
    SELECT promotion_id FROM outcome_external_canonical_promotion
     WHERE environment=NEW.environment AND competition=NEW.competition
       AND status='finalized' AND finalized_at IS NOT NULL
       AND finalized_at<=NEW.knowledge_cutoff_at
  ), members AS (
    SELECT promotion_id FROM outcome_promotion_backed_corpus_promotion
     WHERE corpus_id=NEW.corpus_id
  ), gaps AS (
    SELECT promotion_id FROM eligible_promotions EXCEPT SELECT promotion_id FROM members
    UNION ALL
    SELECT promotion_id FROM members EXCEPT SELECT promotion_id FROM eligible_promotions
  ) SELECT count(*) INTO promotion_gap_count FROM gaps;
  IF promotion_gap_count<>0 THEN
    RAISE EXCEPTION 'Canonical corpus must contain the complete eligible promotion set';
  END IF;

  SELECT count(*) INTO actual_promotion_count
    FROM outcome_promotion_backed_corpus_promotion WHERE corpus_id=NEW.corpus_id;
  SELECT count(*) INTO actual_member_count
    FROM outcome_promotion_backed_corpus_member WHERE corpus_id=NEW.corpus_id;
  IF actual_promotion_count<>NEW.promotion_count OR actual_member_count<>NEW.member_count
     OR NOT EXISTS (SELECT 1 FROM outcome_promotion_backed_corpus_promotion
                     WHERE corpus_id=NEW.corpus_id AND ordinal=1)
     OR (SELECT max(ordinal) FROM outcome_promotion_backed_corpus_promotion
          WHERE corpus_id=NEW.corpus_id)<>NEW.promotion_count
     OR NOT EXISTS (SELECT 1 FROM outcome_promotion_backed_corpus_member
                     WHERE corpus_id=NEW.corpus_id AND ordinal=1)
     OR (SELECT max(ordinal) FROM outcome_promotion_backed_corpus_member
          WHERE corpus_id=NEW.corpus_id)<>NEW.member_count THEN
    RAISE EXCEPTION 'Canonical corpus counts or ordinals do not reconcile';
  END IF;

  SELECT count(*) INTO invalid_promotion_count
    FROM outcome_promotion_backed_corpus_promotion member
    JOIN outcome_external_canonical_promotion promotion ON promotion.promotion_id=member.promotion_id
   WHERE member.corpus_id=NEW.corpus_id AND (
     member.promotion_sha256<>promotion.receipt_sha256
     OR member.anchor_season_year<>promotion.anchor_season_year
     OR member.finalized_at<>promotion.finalized_at
     OR member.promotion_record_count<>promotion.promotion_record_count
     OR member.promotion_record_count<>(SELECT count(*)
          FROM outcome_promotion_backed_corpus_member record
         WHERE record.corpus_id=member.corpus_id AND record.promotion_id=member.promotion_id)
   );
  IF invalid_promotion_count<>0 THEN
    RAISE EXCEPTION 'Corpus promotion_record_count <> actual_record_count';
  END IF;

  SELECT count(*) INTO invalid_member_count
    FROM outcome_promotion_backed_corpus_member member
    JOIN outcome_external_canonical_promotion_record record
      ON record.promotion_id=member.promotion_id AND record.record_kind=member.record_kind
     AND record.source_record_id=member.source_record_id
   WHERE member.corpus_id=NEW.corpus_id
     AND (member.canonical_record_id<>record.canonical_record_id
       OR member.record_sha256<>record.record_sha256);
  IF invalid_member_count<>0 THEN
    RAISE EXCEPTION 'Canonical corpus members drifted from their promotion records';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'promotionId',promotion_id,'promotionSha256',promotion_sha256,
           'anchorSeasonYear',anchor_season_year,
           'finalizedAt',to_char(finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'promotionRecordCount',promotion_record_count
         ) ORDER BY ordinal)
    INTO actual_promotions
    FROM outcome_promotion_backed_corpus_promotion WHERE corpus_id=NEW.corpus_id;
  SELECT jsonb_agg(jsonb_build_object(
           'ordinal',ordinal,'promotionId',promotion_id,'recordKind',record_kind,
           'sourceRecordId',source_record_id,'canonicalRecordId',canonical_record_id,
           'recordSha256',record_sha256
         ) ORDER BY ordinal),
         jsonb_agg(jsonb_build_object(
           'promotionId',promotion_id,'recordKind',record_kind,'sourceRecordId',source_record_id,
           'canonicalRecordId',canonical_record_id,'recordSha256',record_sha256
         ) ORDER BY ordinal)
    INTO actual_members,actual_member_set
    FROM outcome_promotion_backed_corpus_member WHERE corpus_id=NEW.corpus_id;
  SELECT jsonb_build_object(
    'transaction',count(*) FILTER (WHERE record_kind='transaction'),
    'transfer',count(*) FILTER (WHERE record_kind='transfer'),
    'draft_event',count(*) FILTER (WHERE record_kind='draft_event'),
    'draft_selection',count(*) FILTER (WHERE record_kind='draft_selection'),
    'draft_player_asset',count(*) FILTER (WHERE record_kind='draft_player_asset'),
    'pick_custody',count(*) FILTER (WHERE record_kind='pick_custody'),
    'pick_realization',count(*) FILTER (WHERE record_kind='pick_realization')
  ) INTO actual_record_counts
  FROM outcome_promotion_backed_corpus_member WHERE corpus_id=NEW.corpus_id;

  IF NEW.corpus_json->'content'->'promotions' IS DISTINCT FROM actual_promotions
     OR NEW.corpus_json->'content'->'members' IS DISTINCT FROM actual_members
     OR NEW.record_counts_json IS DISTINCT FROM actual_record_counts
     OR NEW.member_set_canonical_json::jsonb IS DISTINCT FROM actual_member_set THEN
    RAISE EXCEPTION 'Canonical corpus content does not equal its typed relational members';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_promotion_backed_corpus_finalization_guard"
BEFORE UPDATE ON "outcome_promotion_backed_corpus"
FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_promotion_backed_corpus"();

CREATE FUNCTION "reject_outcome_promotion_backed_corpus_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Canonical corpus evidence is append-only';
END;
$$;
CREATE TRIGGER "outcome_promotion_backed_corpus_delete_guard"
BEFORE DELETE ON "outcome_promotion_backed_corpus"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_promotion_backed_corpus_mutation"();
CREATE TRIGGER "outcome_promotion_backed_corpus_promotion_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_promotion_backed_corpus_promotion"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_promotion_backed_corpus_mutation"();
CREATE TRIGGER "outcome_promotion_backed_corpus_member_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_promotion_backed_corpus_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_promotion_backed_corpus_mutation"();
