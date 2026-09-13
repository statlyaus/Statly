-- Preserve historical date precision; never manufacture an observation instant.
ALTER TABLE outcome_pick_custody_observation
 ALTER COLUMN observed_at DROP NOT NULL,
 ADD COLUMN observed_date JSONB,
 ADD COLUMN predecessor_custody_id TEXT;
ALTER TABLE outcome_pick_custody_observation ADD CONSTRAINT outcome_pick_custody_date_precision_check CHECK (
 COALESCE((observed_at IS NOT NULL AND observed_date IS NULL) OR
 (observed_at IS NULL AND jsonb_typeof(observed_date)='object' AND (
   (observed_date->>'precision'='year'
    AND observed_date=jsonb_build_object('precision','year','year',observed_date->'year')
    AND jsonb_typeof(observed_date->'year')='number'
    AND (observed_date->>'year')::NUMERIC=trunc((observed_date->>'year')::NUMERIC)
    AND (observed_date->>'year')::INTEGER BETWEEN 1988 AND 2200)
   OR (observed_date->>'precision'='day'
    AND observed_date=jsonb_build_object('precision','day','date',observed_date->'date')
    AND observed_date->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND to_char((observed_date->>'date')::DATE,'YYYY-MM-DD')=observed_date->>'date')
 )),FALSE)
);
ALTER TABLE outcome_pick_custody_observation
 ADD CONSTRAINT outcome_pick_custody_predecessor_fk FOREIGN KEY(predecessor_custody_id)
 REFERENCES outcome_pick_custody_observation(custody_observation_id) ON DELETE RESTRICT
 DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT outcome_pick_custody_not_own_predecessor CHECK (predecessor_custody_id IS DISTINCT FROM custody_observation_id);

CREATE FUNCTION outcome_pick_custody_date_bounds(at_time TIMESTAMPTZ, partial_date JSONB)
RETURNS TABLE(earliest TIMESTAMPTZ,latest TIMESTAMPTZ) LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE WHEN at_time IS NOT NULL THEN at_time
   WHEN partial_date->>'precision'='day' THEN (partial_date->>'date')::DATE::TIMESTAMP AT TIME ZONE 'UTC'
   ELSE make_date((partial_date->>'year')::INTEGER,1,1)::TIMESTAMP AT TIME ZONE 'UTC' END,
 CASE WHEN at_time IS NOT NULL THEN at_time
   WHEN partial_date->>'precision'='day' THEN (((partial_date->>'date')::DATE+1)::TIMESTAMP AT TIME ZONE 'UTC')-interval '1 microsecond'
   ELSE (make_date((partial_date->>'year')::INTEGER+1,1,1)::TIMESTAMP AT TIME ZONE 'UTC')-interval '1 microsecond' END
$$;
CREATE FUNCTION guard_outcome_pick_custody_predecessor() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE current_row outcome_pick_custody_observation%ROWTYPE:=NEW;
 parent outcome_pick_custody_observation%ROWTYPE; seen TEXT[]:=ARRAY[NEW.custody_observation_id];
 latest_allowed TIMESTAMPTZ; bounds RECORD;
BEGIN
 SELECT latest INTO latest_allowed FROM outcome_pick_custody_date_bounds(NEW.observed_at,NEW.observed_date);
 WHILE current_row.predecessor_custody_id IS NOT NULL LOOP
   IF current_row.predecessor_custody_id=ANY(seen) THEN RAISE EXCEPTION 'Pick custody predecessor cycle'; END IF;
   SELECT * INTO parent FROM outcome_pick_custody_observation WHERE custody_observation_id=current_row.predecessor_custody_id;
   IF NOT FOUND OR parent.pick_id IS DISTINCT FROM NEW.pick_id
   THEN RAISE EXCEPTION 'Pick custody predecessor must belong to the same pick'; END IF;
   SELECT * INTO bounds FROM outcome_pick_custody_date_bounds(parent.observed_at,parent.observed_date);
   IF bounds.earliest>latest_allowed THEN RAISE EXCEPTION 'Pick custody predecessor contradicts chronological order'; END IF;
   latest_allowed:=LEAST(latest_allowed,bounds.latest);seen:=array_append(seen,parent.custody_observation_id);current_row:=parent;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER outcome_pick_custody_predecessor_guard AFTER INSERT ON outcome_pick_custody_observation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_outcome_pick_custody_predecessor();
