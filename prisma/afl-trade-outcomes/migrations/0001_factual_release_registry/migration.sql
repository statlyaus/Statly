CREATE TABLE "outcome_registry_head" (
    "singleton_id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL,
    "last_event_id" TEXT,
    "registry_json" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outcome_registry_head_pkey" PRIMARY KEY ("singleton_id"),
    CONSTRAINT "outcome_registry_head_singleton_check" CHECK ("singleton_id" = 1),
    CONSTRAINT "outcome_registry_head_revision_check" CHECK ("revision" >= 0),
    CONSTRAINT "outcome_registry_head_json_check" CHECK (jsonb_typeof("registry_json") = 'object')
);

INSERT INTO "outcome_registry_head" (
    "singleton_id", "revision", "last_event_id", "registry_json"
) VALUES (
    1, 0, NULL,
    '{"revision":0,"releases":{},"activeByScope":{},"events":[]}'::jsonb
);

CREATE TABLE "outcome_release_manifest" (
    "release_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_through" TIMESTAMPTZ(3) NOT NULL,
    "manifest_json" JSONB NOT NULL,
    CONSTRAINT "outcome_release_manifest_pkey" PRIMARY KEY ("release_id"),
    CONSTRAINT "outcome_release_manifest_id_check" CHECK ("release_id" ~ '^outcome-release:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_release_manifest_environment_check" CHECK ("environment" IN ('test_fixture', 'non_production', 'production')),
    CONSTRAINT "outcome_release_manifest_chronology_check" CHECK ("effective_through" <= "created_at"),
    CONSTRAINT "outcome_release_manifest_json_check" CHECK (jsonb_typeof("manifest_json") = 'object')
);

CREATE INDEX "outcome_release_manifest_scope_key_created_at_idx"
    ON "outcome_release_manifest"("scope_key", "created_at");

CREATE TABLE "outcome_projection_manifest" (
    "projection_id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "manifest_json" JSONB NOT NULL,
    CONSTRAINT "outcome_projection_manifest_pkey" PRIMARY KEY ("projection_id"),
    CONSTRAINT "outcome_projection_manifest_release_projection_key" UNIQUE ("release_id", "projection_id"),
    CONSTRAINT "outcome_projection_manifest_id_check" CHECK ("projection_id" ~ '^outcome-projection:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_projection_manifest_json_check" CHECK (jsonb_typeof("manifest_json") = 'object'),
    CONSTRAINT "outcome_projection_manifest_release_id_fkey"
        FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "outcome_registry_event" (
    "revision" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "previous_event_id" TEXT,
    "release_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "event_json" JSONB NOT NULL,
    CONSTRAINT "outcome_registry_event_pkey" PRIMARY KEY ("revision"),
    CONSTRAINT "outcome_registry_event_event_id_key" UNIQUE ("event_id"),
    CONSTRAINT "outcome_registry_event_previous_event_id_key" UNIQUE ("previous_event_id"),
    CONSTRAINT "outcome_registry_event_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "outcome_registry_event_id_check" CHECK ("event_id" ~ '^outcome-release-event:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_registry_event_action_check" CHECK ("action" IN ('register', 'validate', 'approve', 'activate', 'reject', 'withdraw')),
    CONSTRAINT "outcome_registry_event_json_check" CHECK (jsonb_typeof("event_json") = 'object'),
    CONSTRAINT "outcome_registry_event_release_id_fkey"
        FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_registry_event_previous_event_id_fkey"
        FOREIGN KEY ("previous_event_id") REFERENCES "outcome_registry_event"("event_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outcome_registry_event_scope_key_revision_idx"
    ON "outcome_registry_event"("scope_key", "revision");
CREATE INDEX "outcome_registry_event_release_id_revision_idx"
    ON "outcome_registry_event"("release_id", "revision");

CREATE TABLE "outcome_record_state_commitment" (
    "event_revision" INTEGER NOT NULL,
    "release_id" TEXT NOT NULL,
    "record_state_id" TEXT NOT NULL,
    "record_state_json" JSONB NOT NULL,
    CONSTRAINT "outcome_record_state_commitment_pkey" PRIMARY KEY ("event_revision", "release_id"),
    CONSTRAINT "outcome_record_state_commitment_record_state_id_key" UNIQUE ("record_state_id"),
    CONSTRAINT "outcome_record_state_commitment_id_check" CHECK ("record_state_id" ~ '^outcome-release-record-state:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_record_state_commitment_json_check" CHECK (jsonb_typeof("record_state_json") = 'object'),
    CONSTRAINT "outcome_record_state_commitment_event_revision_fkey"
        FOREIGN KEY ("event_revision") REFERENCES "outcome_registry_event"("revision")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outcome_record_state_commitment_release_id_fkey"
        FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outcome_record_state_commitment_release_revision_idx"
    ON "outcome_record_state_commitment"("release_id", "event_revision");

CREATE TABLE "outcome_active_release" (
    "scope_key" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "activated_at" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL,
    CONSTRAINT "outcome_active_release_pkey" PRIMARY KEY ("scope_key"),
    CONSTRAINT "outcome_active_release_release_id_key" UNIQUE ("release_id"),
    CONSTRAINT "outcome_active_release_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "outcome_active_release_release_id_fkey"
        FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "outcome_projection_item" (
    "release_id" TEXT NOT NULL,
    "projection_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "item_key" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "trade_id" TEXT,
    "asset_id" TEXT,
    "year" INTEGER NOT NULL,
    "afl_club_id" TEXT NOT NULL,
    "club_name" TEXT NOT NULL,
    "player_name" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "metric_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "item_json" JSONB NOT NULL,
    CONSTRAINT "outcome_projection_item_pkey" PRIMARY KEY ("projection_id", "ordinal"),
    CONSTRAINT "outcome_projection_item_key_check" CHECK (length(trim("item_key")) > 0),
    CONSTRAINT "outcome_projection_item_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "outcome_projection_item_year_check" CHECK ("year" BETWEEN 1897 AND 2200),
    CONSTRAINT "outcome_projection_item_metric_codes_not_null_check" CHECK ("metric_codes" IS NOT NULL),
    CONSTRAINT "outcome_projection_item_status_codes_not_null_check" CHECK ("status_codes" IS NOT NULL),
    CONSTRAINT "outcome_projection_item_json_check" CHECK (jsonb_typeof("item_json") = 'object'),
    CONSTRAINT "outcome_projection_item_projection_fkey"
        FOREIGN KEY ("release_id", "projection_id")
        REFERENCES "outcome_projection_manifest"("release_id", "projection_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "outcome_projection_item_projection_item_key"
    ON "outcome_projection_item"("projection_id", "item_key");
CREATE INDEX "outcome_projection_item_release_year_ordinal_idx"
    ON "outcome_projection_item"("release_id", "year", "ordinal");
CREATE INDEX "outcome_projection_item_release_club_ordinal_idx"
    ON "outcome_projection_item"("release_id", "afl_club_id", "ordinal");
CREATE INDEX "outcome_projection_item_release_player_ordinal_idx"
    ON "outcome_projection_item"("release_id", "player_name", "ordinal");
CREATE INDEX "outcome_projection_item_metric_codes_gin_idx"
    ON "outcome_projection_item" USING GIN ("metric_codes");
CREATE INDEX "outcome_projection_item_status_codes_gin_idx"
    ON "outcome_projection_item" USING GIN ("status_codes");

CREATE FUNCTION "reject_outcome_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Outcome release evidence is append-only';
END;
$$;

CREATE TRIGGER "outcome_release_manifest_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_release_manifest"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_projection_manifest_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_projection_manifest"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_registry_event_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_registry_event"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_record_state_commitment_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_record_state_commitment"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_projection_item_append_only"
    BEFORE UPDATE OR DELETE ON "outcome_projection_item"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
