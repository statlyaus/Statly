DROP TRIGGER "outcome_release_event_version_eligibility" ON "outcome_release_event_version";

CREATE FUNCTION "validate_outcome_release_event_version_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  release_environment "OutcomeEnvironment";
  target_status "OutcomeRecordStatus";
  target_time TIMESTAMPTZ;
  target_effective_time TIMESTAMPTZ;
  target_kind "OutcomeEventKind";
  target_source_import_row_id TEXT;
  target_competition TEXT;
  target_season_year INTEGER;
BEGIN
  SELECT "effective_through", "environment"::"OutcomeEnvironment"
    INTO cutoff, release_environment
    FROM "outcome_release_manifest"
   WHERE "release_id" = NEW."release_id";
  IF cutoff IS NULL THEN
    RAISE EXCEPTION 'Release membership requires one existing release cutoff';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('outcome-release-parent:' || NEW."event_version_id", 0)
  );
  SELECT version."status", version."recorded_at",
         version."event_date"::timestamp AT TIME ZONE 'UTC', version."kind",
         version."source_import_row_id", event."competition", event."season_year"
    INTO target_status, target_time, target_effective_time, target_kind,
         target_source_import_row_id, target_competition, target_season_year
    FROM "outcome_event_version" version
    JOIN "outcome_event" event ON event."event_id" = version."event_id"
   WHERE version."event_version_id" = NEW."event_version_id";

  IF target_status IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
     OR target_time IS NULL OR target_time > cutoff OR target_effective_time > cutoff THEN
    RAISE EXCEPTION 'Release membership requires approved evidence whose knowledge and effective times are within the release cutoff';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_import_row" source_row
      JOIN "outcome_import_run" import_run
        ON import_run."import_run_id" = source_row."import_run_id"
      JOIN "outcome_import_partition_row" partition_row
        ON partition_row."import_row_id" = source_row."import_row_id"
       AND partition_row."import_run_id" = source_row."import_run_id"
      JOIN "outcome_import_partition" partition
        ON partition."import_partition_id" = partition_row."import_partition_id"
       AND partition."import_run_id" = partition_row."import_run_id"
      JOIN "outcome_source_capture" capture ON capture."capture_id" = import_run."capture_id"
      JOIN "outcome_source_capture_season" capture_scope
        ON capture_scope."capture_id" = capture."capture_id"
      JOIN "outcome_release_source_capture" member
        ON member."capture_id" = capture."capture_id"
       AND member."release_id" = NEW."release_id"
     WHERE source_row."import_row_id" = target_source_import_row_id
       AND source_row."parse_status" = 'approved'::"OutcomeRecordStatus"
       AND import_run."status" = 'approved'::"OutcomeRecordStatus"
       AND source_row."recorded_at" <= cutoff
       AND import_run."completed_at" IS NOT NULL
       AND import_run."completed_at" <= cutoff
       AND capture."environment" = release_environment
       AND partition."competition" = target_competition
       AND partition."season_year" = target_season_year
       AND capture_scope."competition" = target_competition
       AND capture_scope."season_year" = target_season_year
  ) THEN
    RAISE EXCEPTION 'Released events require same-release, same-environment, same-season source provenance';
  END IF;

  IF (SELECT count(*) FROM "outcome_event_party"
       WHERE "event_version_id" = NEW."event_version_id") < 1
     OR (SELECT count(*) FROM "outcome_event_asset"
          WHERE "event_version_id" = NEW."event_version_id") < 1 THEN
    RAISE EXCEPTION 'Released events require at least one AFL club party and one typed asset';
  END IF;
  IF target_kind = 'trade'
     AND (SELECT count(*) FROM "outcome_event_party"
           WHERE "event_version_id" = NEW."event_version_id") < 2 THEN
    RAISE EXCEPTION 'Released trades require at least two AFL club parties and one typed asset';
  END IF;
  IF target_kind IN (
       'national_draft', 'preseason_draft', 'rookie_draft', 'midseason_draft',
       'supplemental_selection'
     ) AND (SELECT count(*) FROM "outcome_draft_selection"
             WHERE "event_version_id" = NEW."event_version_id") < 1 THEN
    RAISE EXCEPTION 'Released draft events require at least one typed selection';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "outcome_event_asset"
     WHERE "event_version_id" = NEW."event_version_id"
       AND "status" <> 'approved'::"OutcomeRecordStatus"
  ) OR EXISTS (
    SELECT 1 FROM "outcome_draft_selection"
     WHERE "event_version_id" = NEW."event_version_id"
       AND ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Released event children must be approved and structurally complete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_event_asset" asset
     WHERE asset."event_version_id" = NEW."event_version_id"
       AND asset."kind" = 'player'
       AND NOT (
         EXISTS (
           SELECT 1
             FROM "outcome_player_identity_assignment" assignment
            WHERE assignment."identity_id" = asset."player_identity_id"
              AND assignment."player_id" = asset."player_id"
              AND assignment."status" = 'approved'::"OutcomeRecordStatus"
              AND (
                EXISTS (
                  SELECT 1 FROM "outcome_release_identity_assignment" member
                   WHERE member."assignment_id" = assignment."assignment_id"
                     AND member."release_id" = NEW."release_id"
                ) OR EXISTS (
                  SELECT 1 FROM "outcome_release_review_decision" review
                   WHERE review."decision_id" = assignment."decision_id"
                     AND review."release_id" = NEW."release_id"
                )
              )
         ) OR EXISTS (
           SELECT 1
             FROM "outcome_review_decision" review
            WHERE review."decision_id" = asset."external_identity_decision_id"
              AND review."decision" = 'approved'
              AND review."canonical_record_type" = 'player'
              AND review."canonical_record_id" = asset."player_id"
              AND review."decided_at" <= cutoff
              AND (
                review."subject_type" = 'external_provider_identity'
                OR (
                  release_environment = 'test_fixture'::"OutcomeEnvironment"
                  AND review."subject_type" = 'external_provider_identity_fixture'
                )
              )
              AND NOT EXISTS (
                SELECT 1 FROM "outcome_review_decision" successor
                 WHERE successor."supersedes_decision_id" = review."decision_id"
              )
         ) OR EXISTS (
           SELECT 1
             FROM "outcome_provider_player_resolution" resolution
             JOIN "outcome_provider_player_resolution_head" resolution_head
               ON resolution_head."resolution_id" = resolution."resolution_id"
              AND resolution_head."resolution_case_id" = resolution."resolution_case_id"
              AND resolution_head."revision" = resolution."revision"
             JOIN "outcome_provider_identity_assignment_head" assignment_head
               ON assignment_head."assignment_case_id" = resolution."assignment_case_id"
              AND assignment_head."entity_kind" = 'player'
              AND assignment_head."identity_id" = resolution."player_identity_id"
              AND assignment_head."decision_id" = resolution."decision_id"
              AND assignment_head."revision" = resolution."assignment_revision"
              AND assignment_head."status" = 'active'
             JOIN "outcome_release_review_decision" review
               ON review."release_id" = NEW."release_id"
              AND review."decision_id" = resolution."decision_id"
            WHERE resolution."outcome" = 'approved'
              AND resolution."resolution_scope" = 'provider_identity'
              AND resolution."player_identity_id" = asset."player_identity_id"
              AND resolution."player_id" = asset."player_id"
              AND resolution."decided_at" <= cutoff
              AND resolution."effective_at" <= cutoff
              AND NOT EXISTS (
                SELECT 1 FROM "outcome_review_decision" successor
                 WHERE successor."supersedes_decision_id" = resolution."decision_id"
              )
         )
       )
  ) THEN
    RAISE EXCEPTION 'Released player assets require an exact current legacy assignment or governed provider resolution';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_draft_selection" selection
     WHERE selection."event_version_id" = NEW."event_version_id"
       AND NOT EXISTS (
         SELECT 1
           FROM "outcome_player_identity_assignment" assignment
          WHERE assignment."identity_id" = selection."player_identity_id"
            AND assignment."player_id" = selection."player_id"
            AND assignment."status" = 'approved'::"OutcomeRecordStatus"
            AND (
              EXISTS (
                SELECT 1 FROM "outcome_release_identity_assignment" member
                 WHERE member."assignment_id" = assignment."assignment_id"
                   AND member."release_id" = NEW."release_id"
              ) OR EXISTS (
                SELECT 1 FROM "outcome_release_review_decision" review
                 WHERE review."decision_id" = assignment."decision_id"
                   AND review."release_id" = NEW."release_id"
              )
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM "outcome_review_decision" review
          WHERE review."decision_id" = selection."external_identity_decision_id"
            AND review."decision" = 'approved'
            AND review."canonical_record_type" = 'player'
            AND review."canonical_record_id" = selection."player_id"
            AND review."decided_at" <= cutoff
            AND (
              review."subject_type" = 'external_provider_identity'
              OR (
                release_environment = 'test_fixture'::"OutcomeEnvironment"
                AND review."subject_type" = 'external_provider_identity_fixture'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM "outcome_review_decision" successor
               WHERE successor."supersedes_decision_id" = review."decision_id"
            )
       )
  ) THEN
    RAISE EXCEPTION 'Released draft selections require their exact reviewed identity assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_event_party" party
    JOIN "outcome_club" club ON club."club_id" = party."club_id"
    WHERE party."event_version_id" = NEW."event_version_id"
      AND club."status" <> 'approved'::"OutcomeRecordStatus"
  ) OR EXISTS (
    SELECT 1 FROM "outcome_event_asset" asset
    LEFT JOIN "outcome_club" from_club ON from_club."club_id" = asset."from_club_id"
    LEFT JOIN "outcome_club" to_club ON to_club."club_id" = asset."to_club_id"
    LEFT JOIN "outcome_player" player ON player."player_id" = asset."player_id"
    LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id" = asset."pick_id"
    WHERE asset."event_version_id" = NEW."event_version_id"
      AND (asset."to_club_id" IS NULL
        OR to_club."status" <> 'approved'::"OutcomeRecordStatus"
        OR (target_kind = 'trade' AND asset."from_club_id" IS NULL)
        OR (asset."from_club_id" IS NOT NULL
          AND from_club."status" <> 'approved'::"OutcomeRecordStatus")
        OR (asset."player_id" IS NOT NULL
          AND player."status" <> 'approved'::"OutcomeRecordStatus")
        OR (asset."pick_id" IS NOT NULL
          AND pick."status" <> 'approved'::"OutcomeRecordStatus"))
  ) OR EXISTS (
    SELECT 1 FROM "outcome_draft_selection" selection
    JOIN "outcome_club" club ON club."club_id" = selection."club_id"
    LEFT JOIN "outcome_player" player ON player."player_id" = selection."player_id"
    LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id" = selection."pick_id"
    WHERE selection."event_version_id" = NEW."event_version_id"
      AND (club."status" <> 'approved'::"OutcomeRecordStatus"
        OR player."status" <> 'approved'::"OutcomeRecordStatus"
        OR (selection."pick_id" IS NOT NULL
          AND pick."status" <> 'approved'::"OutcomeRecordStatus"))
  ) THEN
    RAISE EXCEPTION 'Released assets require a receiving club and only approved canonical clubs, players, and picks';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT "source_import_row_id" FROM "outcome_event_party"
       WHERE "event_version_id" = NEW."event_version_id"
      UNION ALL
      SELECT "source_import_row_id" FROM "outcome_event_asset"
       WHERE "event_version_id" = NEW."event_version_id"
      UNION ALL
      SELECT "source_import_row_id" FROM "outcome_draft_selection"
       WHERE "event_version_id" = NEW."event_version_id"
    ) child
    WHERE NOT EXISTS (
      SELECT 1
        FROM "outcome_import_row" source_row
        JOIN "outcome_import_run" import_run
          ON import_run."import_run_id" = source_row."import_run_id"
        JOIN "outcome_import_partition_row" partition_row
          ON partition_row."import_row_id" = source_row."import_row_id"
         AND partition_row."import_run_id" = source_row."import_run_id"
        JOIN "outcome_import_partition" partition
          ON partition."import_partition_id" = partition_row."import_partition_id"
         AND partition."import_run_id" = partition_row."import_run_id"
        JOIN "outcome_source_capture" capture ON capture."capture_id" = import_run."capture_id"
        JOIN "outcome_source_capture_season" capture_scope
          ON capture_scope."capture_id" = capture."capture_id"
        JOIN "outcome_release_source_capture" member
          ON member."capture_id" = capture."capture_id"
         AND member."release_id" = NEW."release_id"
       WHERE source_row."import_row_id" = child."source_import_row_id"
         AND source_row."parse_status" = 'approved'::"OutcomeRecordStatus"
         AND import_run."status" = 'approved'::"OutcomeRecordStatus"
         AND source_row."recorded_at" <= cutoff
         AND import_run."completed_at" IS NOT NULL
         AND import_run."completed_at" <= cutoff
         AND capture."environment" = release_environment
         AND partition."competition" = target_competition
         AND partition."season_year" = target_season_year
         AND capture_scope."competition" = target_competition
         AND capture_scope."season_year" = target_season_year
    )
  ) THEN
    RAISE EXCEPTION 'Released event children require same-release, same-environment, same-season source provenance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_event_asset" asset
     WHERE asset."event_version_id" = NEW."event_version_id"
       AND ((asset."from_club_id" IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM "outcome_event_party" party
               WHERE party."event_version_id" = NEW."event_version_id"
                 AND party."club_id" = asset."from_club_id"
            )) OR (asset."to_club_id" IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM "outcome_event_party" party
               WHERE party."event_version_id" = NEW."event_version_id"
                 AND party."club_id" = asset."to_club_id"
            )))
  ) OR EXISTS (
    SELECT 1 FROM "outcome_draft_selection" selection
     WHERE selection."event_version_id" = NEW."event_version_id"
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_event_party" party
          WHERE party."event_version_id" = NEW."event_version_id"
            AND party."club_id" = selection."club_id"
       )
  ) THEN
    RAISE EXCEPTION 'Released assets and selections must reference an AFL club party in the event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_release_event_version_eligibility"
BEFORE INSERT ON "outcome_release_event_version"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_release_event_version_membership"();

-- PostgreSQL executes BEFORE INSERT triggers before resolving an ON CONFLICT
-- branch. Validate an existing head as the compare-and-swap source here, then
-- let the existing BEFORE UPDATE branch validate the exact same transition.
CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_factual_head"()
RETURNS TRIGGER AS $$
DECLARE fact_row RECORD;
DECLARE current_head RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reconciled-factual-head:' || NEW."subject_key", 0));
  SELECT r."expected_head_revision", r."head_revision", r."recorded_at", fr."finalized_at"
    INTO fact_row FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = NEW."reconciled_fact_id";
  IF NOT FOUND OR fact_row."finalized_at" IS NOT NULL OR NEW."revision" <> fact_row."head_revision" OR
     NEW."updated_at" <> fact_row."recorded_at" THEN
    RAISE EXCEPTION 'Reconciled factual head must bind the exact open-run result revision';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "revision", "updated_at"
      INTO current_head
      FROM "outcome_reconciled_factual_metric_head"
     WHERE "subject_key" = NEW."subject_key"
     FOR UPDATE;
    IF FOUND THEN
      IF current_head."revision" <> fact_row."expected_head_revision" OR
         NEW."revision" <> current_head."revision" + 1 OR
         NEW."updated_at" < current_head."updated_at" THEN
        RAISE EXCEPTION 'Reconciled factual head compare-and-swap revision is stale';
      END IF;
    ELSIF fact_row."expected_head_revision" <> 0 OR NEW."revision" <> 1 THEN
      RAISE EXCEPTION 'Initial reconciled factual head must use revision one';
    END IF;
  ELSE
    IF NEW."subject_key" <> OLD."subject_key" OR OLD."revision" <> fact_row."expected_head_revision" OR
       NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
      RAISE EXCEPTION 'Reconciled factual head compare-and-swap revision is stale';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One activation event can commit the target release becoming published and
-- the prior active release becoming superseded. The independent foreign keys
-- already bind every commitment to the exact event revision and an immutable
-- release manifest; requiring both columns to identify the event target makes
-- the second, superseded commitment impossible.
ALTER TABLE "outcome_record_state_commitment"
  DROP CONSTRAINT "outcome_record_state_commitment_exact_event_release_fkey";

CREATE FUNCTION "validate_outcome_record_state_event_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE registry_event JSONB;
BEGIN
  SELECT "event_json" INTO registry_event
    FROM "outcome_registry_event"
   WHERE "revision" = NEW."event_revision"
   FOR KEY SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        COALESCE(registry_event->'content'->'affectedRecordStates', '[]'::jsonb)
      ) affected
     WHERE affected->>'releaseId' = NEW."release_id"
       AND affected->>'recordStateId' = NEW."record_state_id"
       AND affected->'recordState' = NEW."record_state_json"
  ) THEN
    RAISE EXCEPTION 'A record-state commitment must match one exact affected release state declared by its registry event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_record_state_commitment_event_membership"
BEFORE INSERT ON "outcome_record_state_commitment"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_record_state_event_membership"();
