-- Trigger-owned cursor for autonomous, gap-preserving external capture dispatch.

DO $$
BEGIN
  IF EXISTS (
    WITH ordered_occurrence AS (
      SELECT occurrence.schedule_id,
             occurrence.due_at,
             schedule.cadence_anchor_at,
             schedule.interval_seconds,
             lag(occurrence.due_at) OVER (
               PARTITION BY occurrence.schedule_id ORDER BY occurrence.due_at
             ) AS previous_due_at
      FROM outcome_external_capture_occurrence occurrence
      JOIN outcome_external_capture_schedule schedule USING (schedule_id)
    )
    SELECT 1 FROM ordered_occurrence
    WHERE (previous_due_at IS NULL AND due_at<>cadence_anchor_at)
       OR (previous_due_at IS NOT NULL AND
           due_at<>previous_due_at+make_interval(secs=>interval_seconds))
  ) OR EXISTS (
    SELECT 1
    FROM outcome_external_capture_occurrence unfinished
    WHERE unfinished.status IN ('leased','retry_wait')
      AND EXISTS (
        SELECT 1 FROM outcome_external_capture_occurrence later
        WHERE later.schedule_id=unfinished.schedule_id AND later.due_at>unfinished.due_at
      )
  ) THEN
    RAISE EXCEPTION 'External capture occurrence history is not contiguous and cursor-safe';
  END IF;
END $$;

CREATE TABLE outcome_external_capture_dispatch_cursor (
  schedule_id TEXT PRIMARY KEY REFERENCES outcome_external_capture_schedule(schedule_id)
    ON DELETE RESTRICT,
  next_due_at TIMESTAMPTZ(3) NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT outcome_external_capture_dispatch_cursor_revision_check CHECK (revision>0)
);

CREATE INDEX outcome_external_capture_dispatch_cursor_due_idx
  ON outcome_external_capture_dispatch_cursor(next_due_at,schedule_id);

INSERT INTO outcome_external_capture_dispatch_cursor
  (schedule_id,next_due_at,revision,updated_at)
SELECT schedule.schedule_id,
       COALESCE(
         min(occurrence.due_at) FILTER (
           WHERE occurrence.status IN ('leased','retry_wait')
         ),
         max(occurrence.due_at)+make_interval(secs=>schedule.interval_seconds),
         schedule.cadence_anchor_at
       ),
       1,
       COALESCE(max(occurrence.completed_at),schedule.registered_at)
FROM outcome_external_capture_schedule schedule
LEFT JOIN outcome_external_capture_occurrence occurrence USING (schedule_id)
GROUP BY schedule.schedule_id,schedule.cadence_anchor_at,
         schedule.interval_seconds,schedule.registered_at;

CREATE FUNCTION initialize_outcome_external_capture_dispatch_cursor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO outcome_external_capture_dispatch_cursor
    (schedule_id,next_due_at,revision,updated_at)
  VALUES (NEW.schedule_id,NEW.cadence_anchor_at,1,NEW.registered_at);
  RETURN NEW;
END $$;

CREATE TRIGGER outcome_external_capture_dispatch_cursor_initialize
AFTER INSERT ON outcome_external_capture_schedule
FOR EACH ROW EXECUTE FUNCTION initialize_outcome_external_capture_dispatch_cursor();

CREATE FUNCTION validate_outcome_external_capture_dispatch_due() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_cursor outcome_external_capture_dispatch_cursor%ROWTYPE;
BEGIN
  SELECT * INTO STRICT current_cursor
  FROM outcome_external_capture_dispatch_cursor
  WHERE schedule_id=NEW.schedule_id
  FOR UPDATE;
  IF NEW.due_at<>current_cursor.next_due_at THEN
    RAISE EXCEPTION 'External capture occurrence must claim the exact next due period';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outcome_external_capture_dispatch_due_validate
BEFORE INSERT ON outcome_external_capture_occurrence
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_capture_dispatch_due();

CREATE FUNCTION advance_outcome_external_capture_dispatch_cursor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_cursor outcome_external_capture_dispatch_cursor%ROWTYPE;
DECLARE current_occurrence outcome_external_capture_occurrence%ROWTYPE;
DECLARE interval_seconds INTEGER;
BEGIN
  IF NEW.state NOT IN ('completed','not_modified','skipped_late','dead_letter') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT current_occurrence
  FROM outcome_external_capture_occurrence
  WHERE dispatch_key=NEW.dispatch_key;
  SELECT * INTO STRICT current_cursor
  FROM outcome_external_capture_dispatch_cursor
  WHERE schedule_id=current_occurrence.schedule_id
  FOR UPDATE;
  SELECT schedule.interval_seconds INTO STRICT interval_seconds
  FROM outcome_external_capture_schedule schedule
  WHERE schedule.schedule_id=current_occurrence.schedule_id;
  IF current_occurrence.due_at<>current_cursor.next_due_at THEN
    RAISE EXCEPTION 'Terminal external capture occurrence does not match the dispatch cursor';
  END IF;
  UPDATE outcome_external_capture_dispatch_cursor
  SET next_due_at=current_occurrence.due_at+make_interval(secs=>interval_seconds),
      revision=current_cursor.revision+1,
      updated_at=NEW.occurred_at
  WHERE schedule_id=current_occurrence.schedule_id;
  RETURN NEW;
END $$;

CREATE TRIGGER zz_outcome_external_capture_dispatch_cursor_advance
AFTER INSERT ON outcome_external_capture_occurrence_event
FOR EACH ROW EXECUTE FUNCTION advance_outcome_external_capture_dispatch_cursor();

CREATE FUNCTION reject_outcome_external_capture_dispatch_cursor_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 AND TG_OP IN ('INSERT','UPDATE') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'External capture dispatch cursors are trigger-owned';
END $$;

CREATE TRIGGER outcome_external_capture_dispatch_cursor_protected
BEFORE INSERT OR UPDATE OR DELETE ON outcome_external_capture_dispatch_cursor
FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_capture_dispatch_cursor_mutation();
