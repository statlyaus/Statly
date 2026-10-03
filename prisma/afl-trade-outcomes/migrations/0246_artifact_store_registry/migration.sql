-- Evidence bytes get one registered home per environment, and every custody row can say where its
-- bytes live.
--
-- outcome_artifact_custody proves which bytes an artifact is (content SHA-256, length, media type)
-- but not where they are kept. Repositories were composed against ad hoc roots, including system
-- temporary folders, so files went missing while every custody check still passed.
--
-- outcome_artifact_store lists the stores. A local non-production filesystem store may exist only in
-- non_production, at most once per environment, rooted at an absolute path. Its rows are permanent;
-- the only later change is recording the mirror locator once.
--
-- outcome_artifact_custody_location binds one custody row to one store and object key. It is a
-- separate append-only table because custody rows are immutable (0089 rejects every UPDATE), so a
-- location cannot be added to an existing custody row in place, and that guard is not relaxed here.
-- A custody row without a location row is an artifact whose bytes have not been found in a
-- registered store. The object key must end in the artifact's own two-level SHA-256 path, so a
-- location can never point at different bytes.

CREATE TABLE "outcome_artifact_store" (
  "store_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "assurance" TEXT NOT NULL,
  "root_locator" TEXT NOT NULL,
  "mirror_locator" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_artifact_store_pkey" PRIMARY KEY ("store_id"),
  CONSTRAINT "outcome_artifact_store_id_check" CHECK ("store_id" ~ '^[a-z][a-z0-9-]{2,62}$'),
  CONSTRAINT "outcome_artifact_store_assurance_check"
    CHECK ("assurance" IN ('local_non_production_filesystem','durable_object_storage')),
  CONSTRAINT "outcome_artifact_store_local_environment_check"
    CHECK ("assurance"<>'local_non_production_filesystem' OR "environment"='non_production'),
  CONSTRAINT "outcome_artifact_store_root_check" CHECK (
    CASE "assurance"
      WHEN 'local_non_production_filesystem'
        THEN "root_locator" ~ '^/' AND "root_locator" !~ '(^|/)\.\.?(/|$)'
      ELSE "root_locator" ~ '^[a-z][a-z0-9+.-]*://[^/]+'
    END
  ),
  CONSTRAINT "outcome_artifact_store_mirror_check"
    CHECK ("mirror_locator" IS NULL OR "mirror_locator" ~ '^[a-z][a-z0-9+.-]*://[^/]+')
);

CREATE UNIQUE INDEX "outcome_artifact_store_one_local_per_environment"
  ON "outcome_artifact_store" ("environment")
  WHERE "assurance"='local_non_production_filesystem';

CREATE FUNCTION "guard_outcome_artifact_store_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Artifact stores are permanent' USING ERRCODE='55000';
  END IF;
  IF NEW."store_id" IS DISTINCT FROM OLD."store_id"
    OR NEW."environment" IS DISTINCT FROM OLD."environment"
    OR NEW."assurance" IS DISTINCT FROM OLD."assurance"
    OR NEW."root_locator" IS DISTINCT FROM OLD."root_locator"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR OLD."mirror_locator" IS NOT NULL
    OR NEW."mirror_locator" IS NULL
  THEN
    RAISE EXCEPTION 'An artifact store may only record its mirror locator, once' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_artifact_store_write_guard"
BEFORE UPDATE OR DELETE ON "outcome_artifact_store"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_artifact_store_write"();

CREATE TABLE "outcome_artifact_custody_location" (
  "artifact_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "located_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_artifact_custody_location_pkey" PRIMARY KEY ("artifact_id"),
  CONSTRAINT "outcome_artifact_custody_location_artifact_fkey" FOREIGN KEY ("artifact_id")
    REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_artifact_custody_location_store_fkey" FOREIGN KEY ("store_id")
    REFERENCES "outcome_artifact_store"("store_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_artifact_custody_location_key_check" CHECK (
    length("object_key") <= 1024
    AND "object_key" ~ '^[A-Za-z0-9._:-]+(/[A-Za-z0-9._:-]+)*$'
    AND "object_key" !~ '(^|/)\.\.?(/|$)'
  )
);

CREATE UNIQUE INDEX "outcome_artifact_custody_location_store_key"
  ON "outcome_artifact_custody_location" ("store_id","object_key");

CREATE FUNCTION "validate_outcome_artifact_custody_location_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE custody RECORD; store RECORD; expected_suffix TEXT;
BEGIN
  SELECT "content_sha256","environment" INTO custody
    FROM "outcome_artifact_custody" WHERE "artifact_id"=NEW."artifact_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artifact location requires existing custody' USING ERRCODE='23503';
  END IF;
  SELECT "environment" INTO store
    FROM "outcome_artifact_store" WHERE "store_id"=NEW."store_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artifact location requires a registered store' USING ERRCODE='23503';
  END IF;
  IF store."environment"<>custody."environment" THEN
    RAISE EXCEPTION 'Artifact location store environment differs from its custody environment'
      USING ERRCODE='23514';
  END IF;
  expected_suffix:='sha256/'||substr(custody."content_sha256",1,2)||'/'
    ||substr(custody."content_sha256",3,2)||'/'||custody."content_sha256";
  -- A SHA-256 is hexadecimal, so the suffix carries no LIKE wildcard.
  IF NEW."object_key"<>expected_suffix AND NEW."object_key" NOT LIKE '%/'||expected_suffix THEN
    RAISE EXCEPTION 'Artifact location key must end in the artifact''s own SHA-256 path'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_artifact_custody_location_insert_guard"
BEFORE INSERT ON "outcome_artifact_custody_location"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_artifact_custody_location_insert"();

CREATE TRIGGER "outcome_artifact_custody_location_no_write"
BEFORE UPDATE OR DELETE ON "outcome_artifact_custody_location"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();
