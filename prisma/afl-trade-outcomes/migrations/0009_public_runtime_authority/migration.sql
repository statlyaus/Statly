-- Durable governance and valuation-publication authority for the public AFL archive.
-- This boundary is intentionally isolated from fantasy users, leagues, rosters, and trades.

CREATE TABLE "outcome_source_rights_proposal" (
    "rights_artifact_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "capability_id" TEXT,
    "proposed_at" TIMESTAMPTZ(3) NOT NULL,
    "content_json" JSONB NOT NULL,
    CONSTRAINT "outcome_source_rights_proposal_pkey" PRIMARY KEY ("rights_artifact_id"),
    CONSTRAINT "outcome_source_rights_exact_identity_key"
        UNIQUE ("provider", "dataset", "dataset_version", "capability_id", "rights_artifact_id"),
    CONSTRAINT "outcome_source_rights_id_check"
        CHECK ("rights_artifact_id" ~ '^source-rights:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_source_rights_json_check"
        CHECK (
            jsonb_typeof("content_json") = 'object'
            AND "content_json"->>'rightsArtifactId' = "rights_artifact_id"
            AND "content_json"->'content'->>'schemaVersion' = 'afl-trade-source-rights/v2'
            AND "content_json"->'content'->>'provider' = "provider"
            AND "content_json"->'content'->>'dataset' = "dataset"
            AND "content_json"->'content'->>'datasetVersion' = "dataset_version"
            AND ("content_json"->'content'->>'proposedAt')::TIMESTAMPTZ = "proposed_at"
        ),
    CONSTRAINT "outcome_source_rights_fitzroy_capability_check"
        CHECK (
            "content_json"->'content'->'acquisition'->>'kind' <> 'fitzroy'
            OR (
                "capability_id" IS NOT NULL
                AND jsonb_array_length("content_json"->'content'->'acquisition'->'capabilities') = 1
                AND "content_json"->'content'->'acquisition'->'capabilities'->0->>'capabilityId' = "capability_id"
                AND "content_json"->'content'->'acquisition'->'capabilities'->0->>'provider' = "provider"
            )
        )
);

CREATE INDEX "outcome_source_rights_provider_capability_idx"
    ON "outcome_source_rights_proposal"("provider", "capability_id", "proposed_at");

CREATE TABLE "outcome_gate_ledger_head" (
    "singleton_id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outcome_gate_ledger_head_pkey" PRIMARY KEY ("singleton_id"),
    CONSTRAINT "outcome_gate_ledger_head_singleton_check" CHECK ("singleton_id" = 1),
    CONSTRAINT "outcome_gate_ledger_head_revision_check" CHECK ("revision" >= 0)
);

CREATE TABLE "outcome_gate_proposal" (
    "proposal_id" TEXT NOT NULL,
    "gate" TEXT NOT NULL,
    "decision_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "environment" "OutcomeEnvironment" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "proposed_at" TIMESTAMPTZ(3) NOT NULL,
    "proposal_json" JSONB NOT NULL,
    CONSTRAINT "outcome_gate_proposal_pkey" PRIMARY KEY ("proposal_id"),
    CONSTRAINT "outcome_gate_proposal_scope_version_key"
        UNIQUE ("gate", "environment", "decision_key", "version"),
    CONSTRAINT "outcome_gate_proposal_id_check"
        CHECK ("proposal_id" ~ '^gate-proposal:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_gate_proposal_version_check" CHECK ("version" > 0),
    CONSTRAINT "outcome_gate_proposal_gate_check"
        CHECK ("gate" IN (
            'gate_0a_permission_to_evaluate', 'gate_0b_data_sufficiency',
            'gate_1_architecture_authority', 'gate_2_corpus_lineage',
            'gate_3_model_validity', 'gate_4_publication_api_readiness',
            'gate_5_comprehension_accessibility', 'gate_6_production_verification'
        )),
    CONSTRAINT "outcome_gate_proposal_json_check"
        CHECK (
            jsonb_typeof("proposal_json") = 'object'
            AND "proposal_json"->>'proposalId' = "proposal_id"
            AND "proposal_json"->'content'->>'schemaVersion' = 'afl-trade-gate-proposal/v1'
            AND "proposal_json"->'content'->>'gate' = "gate"
            AND "proposal_json"->'content'->>'decisionKey' = "decision_key"
            AND ("proposal_json"->'content'->>'version')::INTEGER = "version"
            AND "proposal_json"->'content'->>'environment' = "environment"::TEXT
            AND "proposal_json"->'content'->'scope'->>'scopeKey' = "scope_key"
            AND ("proposal_json"->'content'->>'proposedAt')::TIMESTAMPTZ = "proposed_at"
        )
);

CREATE INDEX "outcome_gate_proposal_scope_idx"
    ON "outcome_gate_proposal"("gate", "environment", "decision_key", "proposed_at");

CREATE TABLE "outcome_gate_decision" (
    "decision_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "gate" TEXT NOT NULL,
    "decision_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "environment" "OutcomeEnvironment" NOT NULL,
    "state" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "effective_at" TIMESTAMPTZ(3),
    "revalidate_at" TIMESTAMPTZ(3),
    "supersedes_decision_id" TEXT,
    "decision_json" JSONB NOT NULL,
    CONSTRAINT "outcome_gate_decision_pkey" PRIMARY KEY ("decision_id"),
    CONSTRAINT "outcome_gate_decision_scope_version_key"
        UNIQUE ("gate", "environment", "decision_key", "version"),
    CONSTRAINT "outcome_gate_decision_supersedes_key" UNIQUE ("supersedes_decision_id"),
    CONSTRAINT "outcome_gate_decision_id_check"
        CHECK ("decision_id" ~ '^gate-decision:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_gate_decision_version_check" CHECK ("version" > 0),
    CONSTRAINT "outcome_gate_decision_state_check"
        CHECK ("state" IN ('pending', 'approved', 'blocked', 'expired', 'withdrawn')),
    CONSTRAINT "outcome_gate_decision_time_check"
        CHECK (
            ("state" = 'pending' AND "decided_at" IS NULL AND "effective_at" IS NULL AND "revalidate_at" IS NULL)
            OR
            ("state" <> 'pending' AND "decided_at" IS NOT NULL AND "effective_at" IS NOT NULL
                AND "effective_at" >= "decided_at")
        ),
    CONSTRAINT "outcome_gate_decision_approval_expiry_check"
        CHECK ("state" <> 'approved' OR ("revalidate_at" IS NOT NULL AND "revalidate_at" > "effective_at")),
    CONSTRAINT "outcome_gate_decision_proposal_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "outcome_gate_proposal"("proposal_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_gate_decision_supersedes_fkey"
        FOREIGN KEY ("supersedes_decision_id") REFERENCES "outcome_gate_decision"("decision_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_gate_decision_json_check"
        CHECK (
            jsonb_typeof("decision_json") = 'object'
            AND "decision_json"->>'decisionId' = "decision_id"
            AND "decision_json"->'content'->>'schemaVersion' = 'afl-trade-gate-decision/v1'
            AND "decision_json"->'content'->>'proposalId' = "proposal_id"
            AND "decision_json"->'content'->>'gate' = "gate"
            AND "decision_json"->'content'->>'decisionKey' = "decision_key"
            AND ("decision_json"->'content'->>'version')::INTEGER = "version"
            AND "decision_json"->'content'->>'environment' = "environment"::TEXT
            AND "decision_json"->'content'->>'state' = "state"
            AND ("decision_json"->'content'->>'supersedesDecisionId') IS NOT DISTINCT FROM "supersedes_decision_id"
        )
);

CREATE INDEX "outcome_gate_decision_scope_idx"
    ON "outcome_gate_decision"("gate", "environment", "decision_key", "effective_at");

CREATE FUNCTION "validate_outcome_gate_decision_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    proposal_row "outcome_gate_proposal"%ROWTYPE;
    predecessor "outcome_gate_decision"%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'afl-trade-gate:' || NEW."gate" || ':' || NEW."environment"::TEXT || ':' || NEW."decision_key",
        0
    ));

    SELECT * INTO STRICT proposal_row
      FROM "outcome_gate_proposal"
     WHERE "proposal_id" = NEW."proposal_id";
    IF proposal_row."gate" <> NEW."gate"
       OR proposal_row."decision_key" <> NEW."decision_key"
       OR proposal_row."version" <> NEW."version"
       OR proposal_row."environment" <> NEW."environment" THEN
        RAISE EXCEPTION 'Gate decision identity does not match its proposal';
    END IF;

    IF NEW."version" = 1 THEN
        IF NEW."supersedes_decision_id" IS NOT NULL THEN
            RAISE EXCEPTION 'The first Gate decision cannot supersede another decision';
        END IF;
    ELSE
        IF NEW."supersedes_decision_id" IS NULL THEN
            RAISE EXCEPTION 'A later Gate decision must supersede the current decision';
        END IF;
        SELECT * INTO STRICT predecessor
          FROM "outcome_gate_decision"
         WHERE "decision_id" = NEW."supersedes_decision_id";
        IF predecessor."gate" <> NEW."gate"
           OR predecessor."environment" <> NEW."environment"
           OR predecessor."decision_key" <> NEW."decision_key"
           OR predecessor."version" <> NEW."version" - 1
           OR predecessor."effective_at" > NEW."effective_at"
           OR EXISTS (
               SELECT 1 FROM "outcome_gate_decision"
                WHERE "supersedes_decision_id" = predecessor."decision_id"
           ) THEN
            RAISE EXCEPTION 'Gate decisions must form one chronological linear chain';
        END IF;
    END IF;

    IF NEW."state" = 'approved'
       AND NEW."environment" = 'production'::"OutcomeEnvironment"
       AND NEW."decision_json"->'content'->>'authorityKind' <> 'external_human_record' THEN
        RAISE EXCEPTION 'Production Gate approval requires external human authority';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_gate_decision_validate_insert"
    BEFORE INSERT ON "outcome_gate_decision"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_decision_insert"();

CREATE FUNCTION "validate_outcome_gate_ledger_commit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    head_revision INTEGER;
    decision_count INTEGER;
BEGIN
    SELECT "revision" INTO STRICT head_revision
      FROM "outcome_gate_ledger_head"
     WHERE "singleton_id" = 1;
    SELECT count(*)::INTEGER INTO decision_count FROM "outcome_gate_decision";
    IF head_revision <> decision_count THEN
        RAISE EXCEPTION 'Gate ledger head revision must equal its immutable decision count';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "outcome_gate_ledger_commit_check"
    AFTER INSERT ON "outcome_gate_decision"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_ledger_commit"();

CREATE CONSTRAINT TRIGGER "outcome_gate_ledger_head_commit_check"
    AFTER UPDATE ON "outcome_gate_ledger_head"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_ledger_commit"();

CREATE TABLE "outcome_valuation_publication_registry_head" (
    "singleton_id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL,
    "registry_json" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outcome_valuation_publication_registry_head_pkey" PRIMARY KEY ("singleton_id"),
    CONSTRAINT "outcome_valuation_registry_singleton_check" CHECK ("singleton_id" = 1),
    CONSTRAINT "outcome_valuation_registry_revision_check" CHECK ("revision" >= 0),
    CONSTRAINT "outcome_valuation_registry_json_check"
        CHECK (
            jsonb_typeof("registry_json") = 'object'
            AND ("registry_json"->>'revision')::INTEGER = "revision"
            AND jsonb_typeof("registry_json"->'publications') = 'object'
            AND jsonb_typeof("registry_json"->'activeByScope') = 'object'
        )
);

CREATE TABLE "outcome_valuation_publication_manifest" (
    "publication_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "manifest_json" JSONB NOT NULL,
    CONSTRAINT "outcome_valuation_publication_manifest_pkey" PRIMARY KEY ("publication_id"),
    CONSTRAINT "outcome_valuation_publication_id_check"
        CHECK ("publication_id" ~ '^publication:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_valuation_publication_json_check"
        CHECK (
            jsonb_typeof("manifest_json") = 'object'
            AND "manifest_json"->>'publicationId' = "publication_id"
            AND "manifest_json"->'content'->>'scopeKey' = "scope_key"
            AND ("manifest_json"->'content'->>'createdAt')::TIMESTAMPTZ = "created_at"
            AND "manifest_json"->'content'->>'schemaVersion' IN ('afl-trade-publication/v2', 'afl-trade-publication/v3')
        )
);

CREATE INDEX "outcome_valuation_publication_scope_created_idx"
    ON "outcome_valuation_publication_manifest"("scope_key", "created_at");

CREATE TABLE "outcome_valuation_projection_manifest" (
    "projection_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "manifest_json" JSONB NOT NULL,
    CONSTRAINT "outcome_valuation_projection_manifest_pkey" PRIMARY KEY ("projection_id"),
    CONSTRAINT "outcome_valuation_projection_publication_key" UNIQUE ("publication_id", "projection_id"),
    CONSTRAINT "outcome_valuation_projection_artifact_key" UNIQUE ("projection_id", "artifact_id"),
    CONSTRAINT "outcome_valuation_projection_id_check"
        CHECK ("projection_id" ~ '^projection:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_valuation_projection_publication_fkey"
        FOREIGN KEY ("publication_id") REFERENCES "outcome_valuation_publication_manifest"("publication_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_valuation_projection_artifact_fkey"
        FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_valuation_projection_json_check"
        CHECK (
            jsonb_typeof("manifest_json") = 'object'
            AND "manifest_json"->>'projectionId' = "projection_id"
            AND "manifest_json"->'content'->>'publicationId' = "publication_id"
            AND ("manifest_json"->'content'->>'createdAt')::TIMESTAMPTZ = "created_at"
            AND "manifest_json"->'content'->>'schemaVersion' IN ('afl-trade-projection/v1', 'afl-trade-projection/v2')
        )
);

CREATE INDEX "outcome_valuation_projection_publication_created_idx"
    ON "outcome_valuation_projection_manifest"("publication_id", "created_at");

CREATE TABLE "outcome_projection_freshness_high_water" (
    "projection_id" TEXT NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL,
    CONSTRAINT "outcome_projection_freshness_high_water_pkey" PRIMARY KEY ("projection_id"),
    CONSTRAINT "outcome_projection_freshness_high_water_projection_fkey"
        FOREIGN KEY ("projection_id") REFERENCES "outcome_valuation_projection_manifest"("projection_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_projection_freshness_high_water_revision_check" CHECK ("revision" > 0)
);

CREATE FUNCTION "validate_outcome_valuation_projection_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    publication_row "outcome_valuation_publication_manifest"%ROWTYPE;
    artifact_row "outcome_artifact_custody"%ROWTYPE;
BEGIN
    SELECT * INTO STRICT publication_row
      FROM "outcome_valuation_publication_manifest"
     WHERE "publication_id" = NEW."publication_id";
    SELECT * INTO STRICT artifact_row
      FROM "outcome_artifact_custody"
     WHERE "artifact_id" = NEW."artifact_id";

    IF NEW."created_at" < publication_row."created_at"
       OR NEW."manifest_json"->'content'->>'scopeKey' <> publication_row."scope_key"
       OR artifact_row."artifact_class" <> 'public_projection'::"OutcomeArtifactClass"
       OR artifact_row."environment"::TEXT <> publication_row."manifest_json"->'content'->>'environment'
       OR artifact_row."verified_at" > NEW."created_at" THEN
        RAISE EXCEPTION 'Valuation projection does not match its publication and verified custody';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_valuation_projection_validate_insert"
    BEFORE INSERT ON "outcome_valuation_projection_manifest"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_projection_insert"();

CREATE TABLE "outcome_valuation_publication_event" (
    "revision" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "previous_event_id" TEXT,
    "publication_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "event_json" JSONB NOT NULL,
    CONSTRAINT "outcome_valuation_publication_event_pkey" PRIMARY KEY ("revision"),
    CONSTRAINT "outcome_valuation_publication_event_id_key" UNIQUE ("event_id"),
    CONSTRAINT "outcome_valuation_publication_previous_event_key" UNIQUE ("previous_event_id"),
    CONSTRAINT "outcome_valuation_publication_event_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "outcome_valuation_publication_event_id_check"
        CHECK ("event_id" ~ '^publication-event:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_valuation_publication_event_action_check"
        CHECK ("action" IN ('register', 'validate', 'approve', 'publish', 'reject', 'withdraw')),
    CONSTRAINT "outcome_valuation_publication_event_json_check"
        CHECK (jsonb_typeof("event_json") = 'object'),
    CONSTRAINT "outcome_valuation_publication_event_publication_fkey"
        FOREIGN KEY ("publication_id") REFERENCES "outcome_valuation_publication_manifest"("publication_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_valuation_publication_previous_event_fkey"
        FOREIGN KEY ("previous_event_id") REFERENCES "outcome_valuation_publication_event"("event_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outcome_valuation_publication_event_publication_idx"
    ON "outcome_valuation_publication_event"("publication_id", "revision");

CREATE FUNCTION "validate_outcome_valuation_event_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prior_event "outcome_valuation_publication_event"%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('afl-trade-valuation-publication-registry', 0));
    IF NEW."revision" = 1 THEN
        IF NEW."previous_event_id" IS NOT NULL THEN
            RAISE EXCEPTION 'The first valuation publication event cannot have a predecessor';
        END IF;
    ELSE
        SELECT * INTO STRICT prior_event
          FROM "outcome_valuation_publication_event"
         WHERE "revision" = NEW."revision" - 1;
        IF NEW."previous_event_id" IS DISTINCT FROM prior_event."event_id"
           OR NEW."occurred_at" < prior_event."occurred_at" THEN
            RAISE EXCEPTION 'Valuation publication events must form one chronological chain';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_valuation_publication_event_validate_insert"
    BEFORE INSERT ON "outcome_valuation_publication_event"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_event_insert"();

CREATE FUNCTION "validate_outcome_valuation_registry_commit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    head_revision INTEGER;
    event_count INTEGER;
BEGIN
    SELECT "revision" INTO STRICT head_revision
      FROM "outcome_valuation_publication_registry_head"
     WHERE "singleton_id" = 1;
    SELECT count(*)::INTEGER INTO event_count FROM "outcome_valuation_publication_event";
    IF head_revision <> event_count THEN
        RAISE EXCEPTION 'Valuation registry revision must equal its immutable event count';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "outcome_valuation_registry_commit_check"
    AFTER INSERT ON "outcome_valuation_publication_event"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_registry_commit"();

CREATE TABLE "outcome_valuation_active_publication" (
    "scope_key" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "registry_revision" INTEGER NOT NULL,
    "activated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outcome_valuation_active_publication_pkey" PRIMARY KEY ("scope_key"),
    CONSTRAINT "outcome_valuation_active_publication_id_key" UNIQUE ("publication_id"),
    CONSTRAINT "outcome_valuation_active_publication_revision_check" CHECK ("registry_revision" > 0),
    CONSTRAINT "outcome_valuation_active_publication_fkey"
        FOREIGN KEY ("publication_id") REFERENCES "outcome_valuation_publication_manifest"("publication_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION "validate_outcome_valuation_active_pointer"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    registry_row "outcome_valuation_publication_registry_head"%ROWTYPE;
    manifest_row "outcome_valuation_publication_manifest"%ROWTYPE;
BEGIN
    SELECT * INTO STRICT registry_row
      FROM "outcome_valuation_publication_registry_head"
     WHERE "singleton_id" = 1;
    SELECT * INTO STRICT manifest_row
      FROM "outcome_valuation_publication_manifest"
     WHERE "publication_id" = NEW."publication_id";
    IF NEW."registry_revision" <> registry_row."revision"
       OR manifest_row."scope_key" <> NEW."scope_key"
       OR registry_row."registry_json"->'activeByScope'->NEW."scope_key"->>'publicationId' <> NEW."publication_id"
       OR registry_row."registry_json"->'publications'->NEW."publication_id"->>'state' <> 'published'
       OR NOT EXISTS (
           SELECT 1 FROM "outcome_valuation_projection_manifest"
            WHERE "publication_id" = NEW."publication_id"
              AND "projection_id" = registry_row."registry_json"->'publications'->NEW."publication_id"->>'projectionId'
       ) THEN
        RAISE EXCEPTION 'Active valuation pointer does not match the published registry head';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_valuation_active_pointer_validate"
    BEFORE INSERT OR UPDATE ON "outcome_valuation_active_publication"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_active_pointer"();

CREATE FUNCTION "validate_outcome_gate_head_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."singleton_id" <> OLD."singleton_id"
       OR NEW."revision" <= OLD."revision"
       OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'Gate ledger head requires a positive chronological CAS update';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_gate_ledger_head_validate_update"
    BEFORE UPDATE ON "outcome_gate_ledger_head"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_head_update"();

CREATE FUNCTION "validate_outcome_valuation_registry_head_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('afl-trade-valuation-publication-registry', 0));
    IF NEW."singleton_id" <> OLD."singleton_id"
       OR NEW."revision" <> OLD."revision" + 1
       OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'Valuation registry head requires a one-revision chronological CAS update';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_valuation_registry_head_validate_update"
    BEFORE UPDATE ON "outcome_valuation_publication_registry_head"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_registry_head_update"();

CREATE TRIGGER "outcome_source_rights_proposal_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_source_rights_proposal"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_gate_proposal_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_gate_proposal"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_gate_decision_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_gate_decision"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_valuation_publication_manifest_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_valuation_publication_manifest"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_valuation_projection_manifest_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_valuation_projection_manifest"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_valuation_publication_event_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_valuation_publication_event"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

INSERT INTO "outcome_gate_ledger_head" ("singleton_id", "revision", "updated_at")
VALUES (1, 0, '1970-01-01T00:00:00.000Z');

INSERT INTO "outcome_valuation_publication_registry_head" (
    "singleton_id", "revision", "registry_json", "updated_at"
) VALUES (
    1, 0, '{"revision":0,"publications":{},"activeByScope":{}}'::jsonb,
    '1970-01-01T00:00:00.000Z'
);
