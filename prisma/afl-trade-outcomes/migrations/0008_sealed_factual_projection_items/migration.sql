ALTER TABLE "outcome_projection_item"
  ADD COLUMN "item_canonical_json" TEXT,
  ADD COLUMN "item_sha256" CHAR(64);

ALTER TABLE "outcome_projection_item"
  ADD CONSTRAINT "outcome_projection_item_sha256_check"
  CHECK ("item_sha256" IS NULL OR "item_sha256" ~ '^[a-f0-9]{64}$');

CREATE INDEX "outcome_projection_item_release_club_id_folded_idx"
  ON "outcome_projection_item"("release_id", lower("afl_club_id"), "ordinal");
CREATE INDEX "outcome_projection_item_release_club_name_folded_idx"
  ON "outcome_projection_item"("release_id", lower("club_name"), "ordinal");

CREATE TABLE "outcome_factual_projection_item_set" (
  "projection_id" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "item_count" INTEGER NOT NULL,
  "item_set_sha256" CHAR(64) NOT NULL,
  "finalized_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_factual_projection_item_set_pkey" PRIMARY KEY ("projection_id"),
  CONSTRAINT "outcome_factual_projection_item_set_release_projection_key"
    UNIQUE ("release_id", "projection_id"),
  CONSTRAINT "outcome_factual_projection_item_set_count_check" CHECK ("item_count" >= 0),
  CONSTRAINT "outcome_factual_projection_item_set_sha256_check"
    CHECK ("item_set_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "outcome_factual_projection_item_set_projection_fkey"
    FOREIGN KEY ("release_id", "projection_id")
    REFERENCES "outcome_projection_manifest"("release_id", "projection_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION "validate_outcome_factual_projection_item_insert"()
RETURNS TRIGGER AS $$
DECLARE projection_manifest JSONB;
DECLARE expected_metric_codes TEXT[];
DECLARE expected_status_codes TEXT[];
DECLARE expected_search_text TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-factual-projection-items:' || NEW."projection_id", 0));
  SELECT "manifest_json" INTO projection_manifest
    FROM "outcome_projection_manifest"
   WHERE "release_id" = NEW."release_id" AND "projection_id" = NEW."projection_id"
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projection item requires its exact projection manifest';
  END IF;
  IF projection_manifest->'content'->>'schemaVersion' = 'afl-draft-trade-outcome-projection/v2' THEN
    IF EXISTS (
      SELECT 1 FROM "outcome_factual_projection_item_set"
       WHERE "projection_id" = NEW."projection_id"
    ) THEN
      RAISE EXCEPTION 'Finalized factual projection items are immutable';
    END IF;
    SELECT COALESCE(
             array_agg(DISTINCT check_value->>'metric' ORDER BY check_value->>'metric'),
             ARRAY[]::TEXT[]
           ),
           COALESCE(
             array_agg(DISTINCT check_value->>'status' ORDER BY check_value->>'status'),
             ARRAY[]::TEXT[]
           )
      INTO expected_metric_codes, expected_status_codes
      FROM jsonb_array_elements(NEW."item_json"->'checks') AS checks(check_value);
    expected_search_text := concat_ws(
      ' ',
      NEW."item_json"->>'eventId',
      NEW."item_json"->>'tradeId',
      NEW."item_json"->>'assetId',
      NEW."item_json"->>'acquisitionType',
      NEW."item_json"->>'aflClubId',
      NEW."item_json"->>'clubName',
      NEW."item_json"->'player'->>'aflPlayerId',
      NEW."item_json"->'player'->>'displayName'
    );
    IF NEW."item_canonical_json" IS NULL OR NEW."item_sha256" IS NULL OR
       NEW."item_key" !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' OR
       encode(sha256(convert_to(NEW."item_canonical_json", 'UTF8')), 'hex') <> NEW."item_sha256" OR
       NEW."item_canonical_json"::jsonb IS DISTINCT FROM NEW."item_json" OR
       NEW."event_id" IS DISTINCT FROM NEW."item_json"->>'eventId' OR
       NEW."trade_id" IS DISTINCT FROM NEW."item_json"->>'tradeId' OR
       NEW."asset_id" IS DISTINCT FROM NEW."item_json"->>'assetId' OR
       NEW."year" IS DISTINCT FROM (NEW."item_json"->>'year')::INTEGER OR
       NEW."afl_club_id" IS DISTINCT FROM NEW."item_json"->>'aflClubId' OR
       NEW."club_name" IS DISTINCT FROM NEW."item_json"->>'clubName' OR
       NEW."player_name" IS DISTINCT FROM NEW."item_json"->'player'->>'displayName' OR
       NEW."search_text" IS DISTINCT FROM expected_search_text OR
       NEW."metric_codes" IS DISTINCT FROM expected_metric_codes OR
       NEW."status_codes" IS DISTINCT FROM expected_status_codes THEN
      RAISE EXCEPTION 'Factual projection item canonical bytes, digest, or index fields mismatch';
    END IF;
  ELSIF NEW."item_canonical_json" IS NOT NULL OR NEW."item_sha256" IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy projection items cannot claim factual item-set evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_factual_projection_item_insert_trigger"
BEFORE INSERT ON "outcome_projection_item"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_projection_item_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_projection_item_set_insert"()
RETURNS TRIGGER AS $$
DECLARE projection_manifest JSONB;
DECLARE projection_created_at TIMESTAMPTZ(3);
DECLARE actual_count INTEGER;
DECLARE candidate_count INTEGER;
DECLARE member_preimage TEXT;
DECLARE actual_sha256 TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-factual-projection-items:' || NEW."projection_id", 0));
  SELECT "manifest_json", "created_at" INTO projection_manifest, projection_created_at
    FROM "outcome_projection_manifest"
   WHERE "release_id" = NEW."release_id" AND "projection_id" = NEW."projection_id"
   FOR KEY SHARE;
  IF NOT FOUND OR
     projection_manifest->'content'->>'schemaVersion' <> 'afl-draft-trade-outcome-projection/v2' THEN
    RAISE EXCEPTION 'Only factual projection-v2 items may be finalized';
  END IF;
  IF NEW."finalized_at" < projection_created_at THEN
    RAISE EXCEPTION 'Factual projection item finalization predates its manifest';
  END IF;

  SELECT count(*) INTO candidate_count
    FROM "outcome_factual_release_candidate"
   WHERE "candidate_id" = projection_manifest->'content'->>'factualCandidateId'
     AND "target_release_id" = NEW."release_id"
     AND "member_set_sha256" = projection_manifest->'content'->>'sourceMemberSetSha256'
     AND "status" = 'approved'
     AND "finalized_at" IS NOT NULL
     AND "finalized_at" <= projection_created_at;
  IF candidate_count <> 1 THEN
    RAISE EXCEPTION 'Factual projection requires a candidate finalized before its manifest';
  END IF;

  SELECT count(*)::INTEGER,
         string_agg(
           "ordinal"::TEXT || E'\n' || "item_key" || E'\n' || "item_sha256",
           E'\n' ORDER BY "ordinal", "item_key"
         )
    INTO actual_count, member_preimage
    FROM "outcome_projection_item"
   WHERE "release_id" = NEW."release_id" AND "projection_id" = NEW."projection_id";

  IF EXISTS (
    SELECT 1 FROM "outcome_projection_item"
     WHERE "release_id" = NEW."release_id" AND "projection_id" = NEW."projection_id"
       AND ("item_canonical_json" IS NULL OR "item_sha256" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Factual projection finalization requires exact canonical item evidence';
  END IF;

  actual_sha256 := encode(
    sha256(
      convert_to(
        'afl-trade-factual-projection-item-set/v1' || E'\n' ||
        'searchable_public_list_rows_no_exports_valuation_or_fantasy_ownership' || E'\n' ||
        actual_count::TEXT ||
        CASE WHEN member_preimage IS NULL THEN '' ELSE E'\n' || member_preimage END,
        'UTF8'
      )
    ),
    'hex'
  );

  IF NEW."item_count" <> actual_count OR
     NEW."item_count" <> (projection_manifest->'content'->>'documentCount')::INTEGER OR
     NEW."item_set_sha256" <> actual_sha256 OR
     NEW."item_set_sha256" <> projection_manifest->'content'->>'publicListItemSetSha256' THEN
    RAISE EXCEPTION 'Factual projection item-set count or digest mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_factual_projection_item_set_insert_trigger"
BEFORE INSERT ON "outcome_factual_projection_item_set"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_projection_item_set_insert"();

CREATE TRIGGER "outcome_factual_projection_item_set_append_only"
BEFORE UPDATE OR DELETE ON "outcome_factual_projection_item_set"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_projection_item_set_event"()
RETURNS TRIGGER AS $$
DECLARE release_manifest JSONB;
DECLARE required_projection_id TEXT;
DECLARE projection_state_count INTEGER;
DECLARE sealed_count INTEGER;
BEGIN
  IF NEW."action" NOT IN ('validate', 'approve', 'activate') THEN
    RETURN NEW;
  END IF;
  SELECT "manifest_json" INTO release_manifest
    FROM "outcome_release_manifest" WHERE "release_id" = NEW."release_id" FOR KEY SHARE;
  IF release_manifest->'content'->>'schemaVersion' <> 'afl-draft-trade-outcome-release/v2' THEN
    RETURN NEW;
  END IF;
  SELECT count(*), max(state_value->'recordState'->'projectionManifest'->>'projectionId')
    INTO projection_state_count, required_projection_id
    FROM jsonb_array_elements(
           COALESCE(NEW."event_json"->'content'->'affectedRecordStates', '[]'::JSONB)
         ) AS states(state_value)
   WHERE state_value->>'releaseId' = NEW."release_id"
     AND state_value->'recordState'->'projectionManifest'->'content'->>'schemaVersion' =
       'afl-draft-trade-outcome-projection/v2';
  IF projection_state_count <> 1 OR required_projection_id IS NULL THEN
    RAISE EXCEPTION 'Factual release event requires its exact projection-v2 record state';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-factual-projection-items:' || required_projection_id, 0));
  SELECT count(*) INTO sealed_count
    FROM "outcome_factual_projection_item_set" item_set
    JOIN "outcome_projection_manifest" projection
      ON projection."release_id" = item_set."release_id"
     AND projection."projection_id" = item_set."projection_id"
   WHERE item_set."release_id" = NEW."release_id"
     AND item_set."projection_id" = required_projection_id
     AND item_set."finalized_at" <= NEW."occurred_at"
     AND item_set."item_set_sha256" = projection."manifest_json"->'content'->>'publicListItemSetSha256';
  IF sealed_count <> 1 THEN
    RAISE EXCEPTION 'Factual release validation requires its exact finalized public item set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ab_validate_outcome_factual_projection_item_set_event"
BEFORE INSERT ON "outcome_registry_event"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_projection_item_set_event"();
