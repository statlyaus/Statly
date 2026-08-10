-- Governed Draftguru discovery inventories and immutable historical capture plans.

ALTER TABLE outcome_external_evidence_row
  DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row
  ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK (claim_kind IN (
    'trade_detail_link', 'transaction', 'transaction_party', 'directed_transfer',
    'draft_selection', 'pick_custody', 'player_draft_detail'
  ));

ALTER TABLE outcome_external_capture_schedule
  DROP CONSTRAINT outcome_external_capture_schedule_capability_check;
ALTER TABLE outcome_external_capture_schedule
  ADD CONSTRAINT outcome_external_capture_schedule_capability_check CHECK (
    (provider = 'draftguru' AND capability_id IN (
      'draftguru-trade-index', 'draftguru-trade-detail', 'draftguru-year-page'
    )) OR
    (provider = 'footywire' AND capability_id = 'footywire-draft-results') OR
    (provider = 'official_afl' AND capability_id = 'official-afl-indicative-draft-order')
  );

CREATE TABLE outcome_external_trade_discovery_inventory (
  inventory_id TEXT PRIMARY KEY,
  environment "OutcomeEnvironment" NOT NULL,
  provider TEXT NOT NULL,
  competition TEXT NOT NULL,
  source_capture_id TEXT NOT NULL REFERENCES outcome_source_capture(capture_id) ON DELETE RESTRICT,
  source_evidence_batch_id TEXT NOT NULL
    REFERENCES outcome_external_evidence_batch(batch_id) ON DELETE RESTRICT,
  source_content_sha256 CHAR(64) NOT NULL,
  source_url TEXT NOT NULL,
  from_year INTEGER NOT NULL,
  through_year INTEGER NOT NULL,
  link_count INTEGER NOT NULL,
  discovered_at TIMESTAMPTZ(3) NOT NULL,
  finalized_at TIMESTAMPTZ(3),
  inventory_json JSONB NOT NULL,
  CONSTRAINT outcome_external_trade_discovery_id_check
    CHECK (inventory_id ~ '^external-trade-discovery:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_trade_discovery_provider_check CHECK (provider = 'draftguru'),
  CONSTRAINT outcome_external_trade_discovery_scope_check
    CHECK (competition = 'AFLM' AND from_year BETWEEN 1988 AND 2200
      AND through_year BETWEEN from_year AND LEAST(from_year + 100, 2200)),
  CONSTRAINT outcome_external_trade_discovery_digest_check
    CHECK (source_content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_trade_discovery_count_check CHECK (link_count > 0),
  CONSTRAINT outcome_external_trade_discovery_url_check
    CHECK (source_url IN ('https://www.draftguru.com.au/trades',
      'https://www.draftguru.com.au/trades/')),
  CONSTRAINT outcome_external_trade_discovery_schema_check
    CHECK (inventory_json->'content'->>'schemaVersion' =
      'afl-trade-external-discovery-inventory/v1'),
  CONSTRAINT outcome_external_trade_discovery_private_check
    CHECK (inventory_json->'content'->>'publicationEligible' = 'false')
);

CREATE INDEX outcome_external_trade_discovery_scope
  ON outcome_external_trade_discovery_inventory(environment, competition, from_year, through_year);

CREATE TABLE outcome_external_trade_discovery_link (
  inventory_id TEXT NOT NULL
    REFERENCES outcome_external_trade_discovery_inventory(inventory_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES outcome_external_evidence_row(evidence_id) ON DELETE RESTRICT,
  anchor_season_year INTEGER NOT NULL,
  native_event_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  link_json JSONB NOT NULL,
  PRIMARY KEY (inventory_id, ordinal),
  CONSTRAINT outcome_external_trade_discovery_link_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT outcome_external_trade_discovery_link_year_check
    CHECK (anchor_season_year BETWEEN 1988 AND 2200),
  CONSTRAINT outcome_external_trade_discovery_link_url_check
    CHECK (source_url ~ '^https://www\.draftguru\.com\.au/trades/[0-9]{4}-'),
  CONSTRAINT outcome_external_trade_discovery_evidence UNIQUE (inventory_id, evidence_id),
  CONSTRAINT outcome_external_trade_discovery_event UNIQUE (inventory_id, native_event_id),
  CONSTRAINT outcome_external_trade_discovery_url UNIQUE (inventory_id, source_url)
);

CREATE INDEX outcome_external_trade_discovery_season_event
  ON outcome_external_trade_discovery_link(anchor_season_year, native_event_id);

CREATE TABLE outcome_external_historical_capture_plan (
  plan_id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL
    REFERENCES outcome_external_trade_discovery_inventory(inventory_id) ON DELETE RESTRICT,
  environment "OutcomeEnvironment" NOT NULL,
  competition TEXT NOT NULL,
  from_year INTEGER NOT NULL,
  through_year INTEGER NOT NULL,
  target_count INTEGER NOT NULL,
  target_set_sha256 CHAR(64) NOT NULL,
  planned_at TIMESTAMPTZ(3) NOT NULL,
  finalized_at TIMESTAMPTZ(3),
  plan_json JSONB NOT NULL,
  CONSTRAINT outcome_external_historical_plan_id_check
    CHECK (plan_id ~ '^external-historical-capture-plan:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_historical_plan_scope_check
    CHECK (competition = 'AFLM' AND from_year BETWEEN 1988 AND 2200
      AND through_year BETWEEN from_year AND LEAST(from_year + 100, 2200)),
  CONSTRAINT outcome_external_historical_plan_count_check CHECK (target_count > 0),
  CONSTRAINT outcome_external_historical_plan_digest_check
    CHECK (target_set_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_historical_plan_schema_check
    CHECK (plan_json->'content'->>'schemaVersion' =
      'afl-trade-external-historical-capture-plan/v1'),
  CONSTRAINT outcome_external_historical_plan_private_check
    CHECK (plan_json->'content'->>'publicationEligible' = 'false')
);

CREATE INDEX outcome_external_historical_plan_scope
  ON outcome_external_historical_capture_plan(environment, competition, from_year, through_year);

CREATE TABLE outcome_external_historical_capture_target (
  plan_id TEXT NOT NULL
    REFERENCES outcome_external_historical_capture_plan(plan_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  target_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL
    REFERENCES outcome_external_capture_schedule(schedule_id) ON DELETE RESTRICT,
  discovery_evidence_id TEXT REFERENCES outcome_external_evidence_row(evidence_id) ON DELETE RESTRICT,
  capability_id TEXT NOT NULL,
  anchor_season_year INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  target_json JSONB NOT NULL,
  PRIMARY KEY (plan_id, ordinal),
  CONSTRAINT outcome_external_historical_target_id_check
    CHECK (target_id ~ '^external-capture-target:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_historical_target_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT outcome_external_historical_target_capability_check
    CHECK (capability_id IN ('draftguru-trade-detail','draftguru-year-page')),
  CONSTRAINT outcome_external_historical_target_year_check
    CHECK (anchor_season_year BETWEEN 1988 AND 2200),
  CONSTRAINT outcome_external_historical_plan_target UNIQUE (plan_id, target_id),
  CONSTRAINT outcome_external_historical_plan_schedule UNIQUE (plan_id, schedule_id)
);

CREATE INDEX outcome_external_historical_target_scope
  ON outcome_external_historical_capture_target(capability_id, anchor_season_year);

CREATE FUNCTION validate_outcome_external_discovery_link_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_finalized TIMESTAMPTZ;
BEGIN
  SELECT finalized_at INTO parent_finalized
  FROM outcome_external_trade_discovery_inventory
  WHERE inventory_id = NEW.inventory_id
  FOR SHARE;
  IF NOT FOUND OR parent_finalized IS NOT NULL THEN
    RAISE EXCEPTION 'Discovery links require an existing open inventory';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_discovery_link_insert_guard
BEFORE INSERT ON outcome_external_trade_discovery_link
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_discovery_link_insert();

CREATE FUNCTION finalize_outcome_external_discovery_inventory()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capture_row RECORD;
DECLARE observed_count INTEGER;
DECLARE invalid_count INTEGER;
BEGIN
  IF OLD.finalized_at IS NOT NULL OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Discovery inventory has an invalid finalization transition';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND
     (to_jsonb(NEW) - 'finalized_at') IS DISTINCT FROM (to_jsonb(OLD) - 'finalized_at') THEN
    RAISE EXCEPTION 'Discovery inventory content is immutable';
  END IF;
  SELECT capture.environment, capture.provider, capture.competition,
         capture.anchor_season_year, capture.capability_id,
         custody.content_sha256, batch.batch_id, batch.status,
         batch.issue_count, batch.evidence_count
  INTO capture_row
  FROM outcome_source_capture capture
  JOIN outcome_artifact_custody custody
    ON custody.artifact_id = capture.source_artifact_id
  JOIN outcome_external_evidence_batch batch
    ON batch.capture_id = capture.capture_id
  WHERE capture.capture_id = NEW.source_capture_id
    AND batch.batch_id = NEW.source_evidence_batch_id;
  IF NOT FOUND OR capture_row.environment IS DISTINCT FROM NEW.environment
     OR capture_row.provider <> 'draftguru'
     OR capture_row.competition <> NEW.competition
     OR capture_row.anchor_season_year <> NEW.through_year
     OR capture_row.capability_id <> 'draftguru-trade-index'
     OR capture_row.content_sha256 <> NEW.source_content_sha256
     OR capture_row.status <> 'finalized'
     OR capture_row.issue_count <> 0
     OR capture_row.evidence_count <> NEW.link_count THEN
    RAISE EXCEPTION 'Discovery inventory source authority mismatch';
  END IF;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE evidence.claim_kind <> 'trade_detail_link'
           OR evidence.batch_id <> NEW.source_evidence_batch_id
           OR link.anchor_season_year NOT BETWEEN NEW.from_year AND NEW.through_year
           OR link.ordinal <> evidence.ordinal
           OR link.evidence_id <> evidence.evidence_id
           OR link.link_json IS DISTINCT FROM
             NEW.inventory_json->'content'->'links'->(link.ordinal - 1))::integer
  INTO observed_count, invalid_count
  FROM outcome_external_trade_discovery_link link
  JOIN outcome_external_evidence_row evidence ON evidence.evidence_id = link.evidence_id
  WHERE link.inventory_id = NEW.inventory_id;
  IF observed_count <> NEW.link_count OR invalid_count <> 0 THEN
    RAISE EXCEPTION 'Discovery inventory link closure mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_discovery_inventory_finalize_guard
BEFORE UPDATE ON outcome_external_trade_discovery_inventory
FOR EACH ROW EXECUTE FUNCTION finalize_outcome_external_discovery_inventory();

CREATE FUNCTION validate_outcome_external_historical_target_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_row RECORD;
DECLARE schedule_row RECORD;
BEGIN
  SELECT finalized_at, environment, competition, from_year, through_year
  INTO plan_row
  FROM outcome_external_historical_capture_plan
  WHERE plan_id = NEW.plan_id
  FOR SHARE;
  IF NOT FOUND OR plan_row.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Historical targets require an existing open plan';
  END IF;
  SELECT environment, provider, capability_id, competition, anchor_season_year, source_url
  INTO schedule_row
  FROM outcome_external_capture_schedule
  WHERE schedule_id = NEW.schedule_id;
  IF NOT FOUND OR schedule_row.environment IS DISTINCT FROM plan_row.environment
     OR schedule_row.provider <> 'draftguru'
     OR schedule_row.competition <> plan_row.competition
     OR schedule_row.capability_id <> NEW.capability_id
     OR schedule_row.anchor_season_year <> NEW.anchor_season_year
     OR schedule_row.source_url <> NEW.source_url
     OR NEW.anchor_season_year NOT BETWEEN plan_row.from_year AND plan_row.through_year THEN
    RAISE EXCEPTION 'Historical target schedule scope mismatch';
  END IF;
  IF (NEW.capability_id = 'draftguru-trade-detail') <> (NEW.discovery_evidence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Historical target discovery evidence mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_historical_target_insert_guard
BEFORE INSERT ON outcome_external_historical_capture_target
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_historical_target_insert();

CREATE FUNCTION finalize_outcome_external_historical_plan()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inventory_row RECORD;
DECLARE observed_count INTEGER;
DECLARE invalid_count INTEGER;
BEGIN
  IF OLD.finalized_at IS NOT NULL OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Historical plan has an invalid finalization transition';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND
     (to_jsonb(NEW) - 'finalized_at') IS DISTINCT FROM (to_jsonb(OLD) - 'finalized_at') THEN
    RAISE EXCEPTION 'Historical plan content is immutable';
  END IF;
  SELECT finalized_at, environment, competition, from_year, through_year
  INTO inventory_row
  FROM outcome_external_trade_discovery_inventory
  WHERE inventory_id = NEW.inventory_id
  FOR SHARE;
  IF NOT FOUND OR inventory_row.finalized_at IS NULL
     OR inventory_row.environment IS DISTINCT FROM NEW.environment
     OR inventory_row.competition <> NEW.competition
     OR inventory_row.from_year <> NEW.from_year
     OR inventory_row.through_year <> NEW.through_year THEN
    RAISE EXCEPTION 'Historical plan inventory authority mismatch';
  END IF;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE target.ordinal <= 0
           OR target.target_json IS DISTINCT FROM
             NEW.plan_json->'content'->'targets'->(target.ordinal - 1)
           OR target.schedule_id <> target.target_json->'content'->'schedule'->>'scheduleId')::integer
  INTO observed_count, invalid_count
  FROM outcome_external_historical_capture_target target
  WHERE target.plan_id = NEW.plan_id;
  IF observed_count <> NEW.target_count OR invalid_count <> 0 THEN
    RAISE EXCEPTION 'Historical plan target closure mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_historical_plan_finalize_guard
BEFORE UPDATE ON outcome_external_historical_capture_plan
FOR EACH ROW EXECUTE FUNCTION finalize_outcome_external_historical_plan();

CREATE FUNCTION reject_outcome_external_discovery_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'External discovery and historical plan records are append-only';
END;
$$;

CREATE TRIGGER outcome_external_discovery_inventory_delete_guard
BEFORE DELETE ON outcome_external_trade_discovery_inventory
FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_discovery_mutation();
CREATE TRIGGER outcome_external_discovery_link_mutation_guard
BEFORE UPDATE OR DELETE ON outcome_external_trade_discovery_link
FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_discovery_mutation();
CREATE TRIGGER outcome_external_historical_plan_delete_guard
BEFORE DELETE ON outcome_external_historical_capture_plan
FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_discovery_mutation();
CREATE TRIGGER outcome_external_historical_target_mutation_guard
BEFORE UPDATE OR DELETE ON outcome_external_historical_capture_target
FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_discovery_mutation();
