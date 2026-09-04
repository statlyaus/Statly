CREATE OR REPLACE FUNCTION validate_outcome_external_historical_target_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_row RECORD;
DECLARE schedule_row RECORD;
DECLARE is_discovered_trade_detail BOOLEAN;
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
  is_discovered_trade_detail := NEW.capability_id IN (
    'draftguru-trade-detail',
    'draftguru-player-trade-detail'
  );
  IF is_discovered_trade_detail <> (NEW.discovery_evidence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Historical target discovery evidence mismatch';
  END IF;
  RETURN NEW;
END;
$$;
