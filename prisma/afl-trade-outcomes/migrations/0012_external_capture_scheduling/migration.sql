-- Durable, bounded scheduling for reviewed external AFL draft/trade source captures.

CREATE TABLE outcome_external_capture_schedule (
  schedule_id TEXT PRIMARY KEY,
  environment "OutcomeEnvironment" NOT NULL,
  provider TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  competition TEXT NOT NULL,
  anchor_season_year INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  cadence_anchor_at TIMESTAMPTZ(3) NOT NULL,
  interval_seconds INTEGER NOT NULL,
  registered_at TIMESTAMPTZ(3) NOT NULL,
  definition_json JSONB NOT NULL,
  CONSTRAINT outcome_external_capture_schedule_id_check
    CHECK (schedule_id ~ '^external-capture-schedule:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_schedule_provider_check
    CHECK (provider IN ('draftguru','footywire','official_afl')),
  CONSTRAINT outcome_external_capture_schedule_capability_check
    CHECK (
      (provider = 'draftguru' AND capability_id IN ('draftguru-trade-detail','draftguru-year-page')) OR
      (provider = 'footywire' AND capability_id = 'footywire-draft-results') OR
      (provider = 'official_afl' AND capability_id = 'official-afl-indicative-draft-order')
    ),
  CONSTRAINT outcome_external_capture_schedule_year_check
    CHECK (anchor_season_year BETWEEN 1897 AND 2200),
  CONSTRAINT outcome_external_capture_schedule_url_check
    CHECK (source_url ~ '^https://'),
  CONSTRAINT outcome_external_capture_schedule_interval_check
    CHECK (interval_seconds BETWEEN 1 AND 31536000),
  CONSTRAINT outcome_external_capture_schedule_schema_check
    CHECK (definition_json->>'schemaVersion' = 'afl-trade-external-capture-schedule-definition/v1'),
  CONSTRAINT outcome_external_capture_schedule_private_check
    CHECK (definition_json->>'publicationEligible' = 'false'),
  CONSTRAINT outcome_external_capture_schedule_exact_scope_key
    UNIQUE (environment, provider, capability_id, source_url, schedule_id)
);

CREATE INDEX outcome_external_capture_schedule_scope_idx
  ON outcome_external_capture_schedule(environment, provider, capability_id, anchor_season_year);

CREATE TABLE outcome_external_capture_schedule_event (
  event_id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES outcome_external_capture_schedule(schedule_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  previous_event_id TEXT UNIQUE REFERENCES outcome_external_capture_schedule_event(event_id) ON DELETE RESTRICT,
  event_json JSONB NOT NULL,
  CONSTRAINT outcome_external_capture_schedule_event_id_check
    CHECK (event_id ~ '^external-capture-schedule-event:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_schedule_event_revision_check CHECK (revision > 0),
  CONSTRAINT outcome_external_capture_schedule_event_state_check
    CHECK (state IN ('active','paused','retired')),
  CONSTRAINT outcome_external_capture_schedule_event_revision_key UNIQUE (schedule_id, revision)
);

CREATE INDEX outcome_external_capture_schedule_event_time_idx
  ON outcome_external_capture_schedule_event(schedule_id, occurred_at);

CREATE TABLE outcome_external_capture_schedule_head (
  schedule_id TEXT PRIMARY KEY REFERENCES outcome_external_capture_schedule(schedule_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE REFERENCES outcome_external_capture_schedule_event(event_id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT outcome_external_capture_schedule_head_revision_check CHECK (revision > 0),
  CONSTRAINT outcome_external_capture_schedule_head_state_check
    CHECK (state IN ('active','paused','retired'))
);

CREATE OR REPLACE FUNCTION validate_outcome_external_capture_schedule_event()
RETURNS TRIGGER AS $$
DECLARE
  current_head outcome_external_capture_schedule_head%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('external-capture-schedule:' || NEW.schedule_id, 0));
  SELECT * INTO current_head
  FROM outcome_external_capture_schedule_head
  WHERE schedule_id = NEW.schedule_id;

  IF NOT FOUND THEN
    IF NEW.revision <> 1 OR NEW.previous_event_id IS NOT NULL OR NEW.state <> 'active' THEN
      RAISE EXCEPTION 'The first external capture schedule event must activate revision one';
    END IF;
  ELSE
    IF current_head.state = 'retired' OR
       NEW.revision <> current_head.revision + 1 OR
       NEW.previous_event_id IS DISTINCT FROM current_head.event_id OR
       NEW.occurred_at < current_head.updated_at THEN
      RAISE EXCEPTION 'External capture schedule event does not advance the exact current head';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outcome_external_capture_schedule_event_validate
BEFORE INSERT ON outcome_external_capture_schedule_event
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_capture_schedule_event();

CREATE OR REPLACE FUNCTION advance_outcome_external_capture_schedule_head()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO outcome_external_capture_schedule_head(schedule_id, revision, state, event_id, updated_at)
  VALUES (NEW.schedule_id, NEW.revision, NEW.state, NEW.event_id, NEW.occurred_at)
  ON CONFLICT (schedule_id) DO UPDATE
  SET revision = EXCLUDED.revision,
      state = EXCLUDED.state,
      event_id = EXCLUDED.event_id,
      updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outcome_external_capture_schedule_event_advance
AFTER INSERT ON outcome_external_capture_schedule_event
FOR EACH ROW EXECUTE FUNCTION advance_outcome_external_capture_schedule_head();

CREATE TABLE outcome_external_capture_occurrence (
  dispatch_key TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES outcome_external_capture_schedule(schedule_id) ON DELETE RESTRICT,
  due_at TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  available_at TIMESTAMPTZ(3) NOT NULL,
  last_claim_id TEXT UNIQUE,
  attempt_number INTEGER NOT NULL,
  completed_at TIMESTAMPTZ(3),
  result_id TEXT,
  failure_code TEXT,
  state_json JSONB NOT NULL,
  CONSTRAINT outcome_external_capture_occurrence_dispatch_check
    CHECK (dispatch_key ~ '^external-capture-dispatch:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_occurrence_status_check
    CHECK (status IN ('leased','retry_wait','completed','not_modified','skipped_late','dead_letter')),
  CONSTRAINT outcome_external_capture_occurrence_revision_check CHECK (revision > 0),
  CONSTRAINT outcome_external_capture_occurrence_attempt_check CHECK (attempt_number >= 0),
  CONSTRAINT outcome_external_capture_occurrence_terminal_check CHECK (
    (status IN ('completed','not_modified','skipped_late','dead_letter')) = (completed_at IS NOT NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_result_check CHECK (
    (status IN ('completed','not_modified')) = (result_id IS NOT NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_failure_check CHECK (
    (status = 'retry_wait') = (failure_code IS NOT NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_claim_check CHECK (
    (status = 'skipped_late' AND last_claim_id IS NULL AND attempt_number = 0) OR
    (status <> 'skipped_late' AND last_claim_id IS NOT NULL AND attempt_number > 0)
  ),
  CONSTRAINT outcome_external_capture_occurrence_schedule_due_key UNIQUE (schedule_id, due_at)
);

CREATE INDEX outcome_external_capture_occurrence_due_idx
  ON outcome_external_capture_occurrence(status, available_at, due_at);

CREATE TABLE outcome_external_capture_attempt (
  claim_id TEXT PRIMARY KEY,
  dispatch_key TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  worker_id TEXT NOT NULL,
  lease_token_sha256 CHAR(64) NOT NULL,
  claimed_at TIMESTAMPTZ(3) NOT NULL,
  lease_expires_at TIMESTAMPTZ(3) NOT NULL,
  claim_json JSONB NOT NULL,
  CONSTRAINT outcome_external_capture_attempt_id_check
    CHECK (claim_id ~ '^external-capture-claim:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_attempt_number_check CHECK (attempt_number > 0),
  CONSTRAINT outcome_external_capture_attempt_worker_check CHECK (length(worker_id) BETWEEN 1 AND 240),
  CONSTRAINT outcome_external_capture_attempt_token_check CHECK (lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_attempt_time_check CHECK (claimed_at < lease_expires_at),
  CONSTRAINT outcome_external_capture_attempt_ordinal_key UNIQUE (dispatch_key, attempt_number),
  CONSTRAINT outcome_external_capture_attempt_occurrence_fkey
    FOREIGN KEY (dispatch_key) REFERENCES outcome_external_capture_occurrence(dispatch_key)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX outcome_external_capture_attempt_lease_idx
  ON outcome_external_capture_attempt(lease_expires_at);

CREATE TABLE outcome_external_capture_occurrence_event (
  event_id TEXT PRIMARY KEY,
  dispatch_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  available_at TIMESTAMPTZ(3) NOT NULL,
  claim_id TEXT,
  result_id TEXT,
  failure_code TEXT,
  previous_event_id TEXT UNIQUE REFERENCES outcome_external_capture_occurrence_event(event_id) ON DELETE RESTRICT,
  event_json JSONB NOT NULL,
  CONSTRAINT outcome_external_capture_occurrence_event_id_check
    CHECK (event_id ~ '^external-capture-occurrence-event:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_capture_occurrence_event_revision_check CHECK (revision > 0),
  CONSTRAINT outcome_external_capture_occurrence_event_state_check
    CHECK (state IN ('leased','retry_wait','completed','not_modified','skipped_late','dead_letter')),
  CONSTRAINT outcome_external_capture_occurrence_event_result_check CHECK (
    (state IN ('completed','not_modified')) = (result_id IS NOT NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_event_failure_check CHECK (
    (state = 'retry_wait') = (failure_code IS NOT NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_event_claim_check CHECK (
    (state = 'skipped_late') = (claim_id IS NULL)
  ),
  CONSTRAINT outcome_external_capture_occurrence_event_revision_key UNIQUE (dispatch_key, revision),
  CONSTRAINT outcome_external_capture_occurrence_event_occurrence_fkey
    FOREIGN KEY (dispatch_key) REFERENCES outcome_external_capture_occurrence(dispatch_key)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT outcome_external_capture_occurrence_event_claim_fkey
    FOREIGN KEY (claim_id) REFERENCES outcome_external_capture_attempt(claim_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX outcome_external_capture_occurrence_event_time_idx
  ON outcome_external_capture_occurrence_event(dispatch_key, occurred_at);

ALTER TABLE outcome_external_capture_occurrence
  ADD CONSTRAINT outcome_external_capture_occurrence_event_fkey
  FOREIGN KEY (event_id) REFERENCES outcome_external_capture_occurrence_event(event_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE outcome_external_capture_occurrence
  ADD CONSTRAINT outcome_external_capture_occurrence_last_claim_fkey
  FOREIGN KEY (last_claim_id) REFERENCES outcome_external_capture_attempt(claim_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION validate_outcome_external_capture_occurrence_event()
RETURNS TRIGGER AS $$
DECLARE
  current_occurrence outcome_external_capture_occurrence%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('external-capture-dispatch:' || NEW.dispatch_key, 0));
  SELECT * INTO current_occurrence
  FROM outcome_external_capture_occurrence
  WHERE dispatch_key = NEW.dispatch_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'External capture occurrence must be staged before its event';
  END IF;

  IF NEW.revision = 1 THEN
    IF NEW.previous_event_id IS NOT NULL OR NEW.state NOT IN ('leased','skipped_late') THEN
      RAISE EXCEPTION 'The first external capture occurrence event has invalid state';
    END IF;
  ELSE
    IF current_occurrence.revision <> NEW.revision - 1 OR
       current_occurrence.event_id IS DISTINCT FROM NEW.previous_event_id OR
       current_occurrence.completed_at IS NOT NULL OR
       NEW.occurred_at < COALESCE(current_occurrence.completed_at, current_occurrence.available_at) THEN
      RAISE EXCEPTION 'External capture occurrence event does not advance the exact current head';
    END IF;
    IF (current_occurrence.status = 'leased' AND NEW.state NOT IN ('leased','retry_wait','completed','not_modified','dead_letter')) OR
       (current_occurrence.status = 'retry_wait' AND NEW.state NOT IN ('leased','dead_letter')) THEN
      RAISE EXCEPTION 'External capture occurrence state transition is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outcome_external_capture_occurrence_event_validate
BEFORE INSERT ON outcome_external_capture_occurrence_event
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_capture_occurrence_event();

CREATE OR REPLACE FUNCTION advance_outcome_external_capture_occurrence()
RETURNS TRIGGER AS $$
DECLARE
  claim_attempt INTEGER;
BEGIN
  IF NEW.claim_id IS NULL THEN
    claim_attempt := 0;
  ELSE
    SELECT attempt_number INTO STRICT claim_attempt
    FROM outcome_external_capture_attempt
    WHERE claim_id = NEW.claim_id AND dispatch_key = NEW.dispatch_key;
  END IF;

  UPDATE outcome_external_capture_occurrence
  SET status = NEW.state,
      revision = NEW.revision,
      event_id = NEW.event_id,
      available_at = NEW.available_at,
      last_claim_id = NEW.claim_id,
      attempt_number = claim_attempt,
      completed_at = CASE WHEN NEW.state IN ('completed','not_modified','skipped_late','dead_letter') THEN NEW.occurred_at ELSE NULL END,
      result_id = NEW.result_id,
      failure_code = NEW.failure_code,
      state_json = NEW.event_json
  WHERE dispatch_key = NEW.dispatch_key;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outcome_external_capture_occurrence_event_advance
AFTER INSERT ON outcome_external_capture_occurrence_event
FOR EACH ROW EXECUTE FUNCTION advance_outcome_external_capture_occurrence();

CREATE OR REPLACE FUNCTION validate_outcome_external_capture_occurrence_head()
RETURNS TRIGGER AS $$
DECLARE
  stored_event outcome_external_capture_occurrence_event%ROWTYPE;
  stored_claim outcome_external_capture_attempt%ROWTYPE;
BEGIN
  SELECT * INTO STRICT stored_event
  FROM outcome_external_capture_occurrence_event
  WHERE event_id = NEW.event_id AND dispatch_key = NEW.dispatch_key;

  IF stored_event.revision <> NEW.revision OR
     stored_event.state <> NEW.status OR
     stored_event.available_at <> NEW.available_at OR
     stored_event.result_id IS DISTINCT FROM NEW.result_id OR
     stored_event.failure_code IS DISTINCT FROM NEW.failure_code OR
     stored_event.claim_id IS DISTINCT FROM NEW.last_claim_id OR
     stored_event.event_json <> NEW.state_json THEN
    RAISE EXCEPTION 'External capture occurrence head does not match its immutable event';
  END IF;

  IF NEW.last_claim_id IS NOT NULL THEN
    SELECT * INTO STRICT stored_claim
    FROM outcome_external_capture_attempt
    WHERE claim_id = NEW.last_claim_id AND dispatch_key = NEW.dispatch_key;
    IF stored_claim.attempt_number <> NEW.attempt_number THEN
      RAISE EXCEPTION 'External capture occurrence attempt does not match its immutable claim';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER outcome_external_capture_occurrence_head_validate
AFTER INSERT OR UPDATE ON outcome_external_capture_occurrence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_capture_occurrence_head();

CREATE TABLE outcome_external_capture_provider_circuit (
  environment "OutcomeEnvironment" NOT NULL,
  provider TEXT NOT NULL,
  revision INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  opened_at TIMESTAMPTZ(3),
  updated_at TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY (environment, provider),
  CONSTRAINT outcome_external_capture_provider_circuit_provider_check
    CHECK (provider IN ('draftguru','footywire','official_afl')),
  CONSTRAINT outcome_external_capture_provider_circuit_revision_check CHECK (revision >= 0),
  CONSTRAINT outcome_external_capture_provider_circuit_failure_check CHECK (
    consecutive_failures >= 0 AND (consecutive_failures = 0) = (opened_at IS NULL)
  )
);

CREATE TRIGGER outcome_external_capture_schedule_append_only
BEFORE UPDATE OR DELETE ON outcome_external_capture_schedule
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();

CREATE TRIGGER outcome_external_capture_schedule_event_append_only
BEFORE UPDATE OR DELETE ON outcome_external_capture_schedule_event
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();

CREATE TRIGGER outcome_external_capture_attempt_append_only
BEFORE UPDATE OR DELETE ON outcome_external_capture_attempt
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();

CREATE TRIGGER outcome_external_capture_occurrence_event_append_only
BEFORE UPDATE OR DELETE ON outcome_external_capture_occurrence_event
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();
