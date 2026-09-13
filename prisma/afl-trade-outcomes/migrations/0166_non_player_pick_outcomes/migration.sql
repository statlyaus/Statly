ALTER TABLE outcome_external_reconciliation_pick_lineage ALTER COLUMN selection_id DROP NOT NULL;
ALTER TABLE outcome_pick_realization
 ALTER COLUMN draft_selection_id DROP NOT NULL,
 ADD COLUMN terminal_outcome JSONB,
 DROP CONSTRAINT outcome_pick_realization_relation_kind_check;
ALTER TABLE outcome_pick_realization ADD CONSTRAINT outcome_pick_realization_terminal_check CHECK (
 COALESCE((relation_kind='exercised_as' AND draft_selection_id IS NOT NULL AND terminal_outcome IS NULL)
 OR (draft_selection_id IS NULL AND jsonb_typeof(terminal_outcome)='object'
 AND terminal_outcome->>'kind'=relation_kind AND (
   (relation_kind IN ('passed','not_exercised')
    AND jsonb_typeof(terminal_outcome->'draftYear')='number'
    AND (terminal_outcome->>'draftYear')::NUMERIC=trunc((terminal_outcome->>'draftYear')::NUMERIC)
    AND (terminal_outcome->>'draftYear')::INTEGER BETWEEN 1988 AND 2200
    AND length(btrim(terminal_outcome->>'draftType')) BETWEEN 1 AND 80
    AND CASE WHEN relation_kind='passed' THEN
      terminal_outcome=jsonb_build_object('kind','passed','draftYear',terminal_outcome->'draftYear','draftType',terminal_outcome->'draftType','livePick',terminal_outcome->'livePick')
      AND jsonb_typeof(terminal_outcome->'livePick')='number'
      AND (terminal_outcome->>'livePick')::NUMERIC=trunc((terminal_outcome->>'livePick')::NUMERIC)
      AND (terminal_outcome->>'livePick')::INTEGER>0
    ELSE
      terminal_outcome=jsonb_build_object('kind','not_exercised','draftYear',terminal_outcome->'draftYear','draftType',terminal_outcome->'draftType','recordedPick',terminal_outcome->'recordedPick')
      AND jsonb_typeof(terminal_outcome->'recordedPick')='number'
      AND (terminal_outcome->>'recordedPick')::NUMERIC=trunc((terminal_outcome->>'recordedPick')::NUMERIC)
      AND (terminal_outcome->>'recordedPick')::INTEGER>0 END)
   OR (relation_kind='incorporated_into_later_package'
    AND terminal_outcome=jsonb_build_object('kind',relation_kind,'onwardTransactionIds',terminal_outcome->'onwardTransactionIds','packageDescription',terminal_outcome->'packageDescription')
    AND jsonb_typeof(terminal_outcome->'onwardTransactionIds')='array'
    AND jsonb_array_length(terminal_outcome->'onwardTransactionIds')<=100
    AND length(btrim(terminal_outcome->>'packageDescription')) BETWEEN 1 AND 4000)
 )),FALSE)
);
CREATE UNIQUE INDEX outcome_pick_realization_terminal_transfer_key
 ON outcome_pick_realization(transfer_asset_version_id) WHERE draft_selection_id IS NULL;

CREATE FUNCTION guard_outcome_pick_terminal_outcome() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pick-terminal:'||NEW.transfer_asset_version_id,0));
 IF EXISTS (SELECT 1 FROM outcome_pick_realization stored WHERE stored.transfer_asset_version_id=NEW.transfer_asset_version_id
   AND (NEW.draft_selection_id IS NULL OR stored.draft_selection_id IS NULL))
 THEN RAISE EXCEPTION 'Non-player outcome conflicts with an existing realization'; END IF;
 IF NEW.terminal_outcome IS NOT NULL THEN
   IF NEW.relation_kind IN ('passed','not_exercised') AND jsonb_typeof(NEW.terminal_outcome->'draftType') IS DISTINCT FROM 'string'
   THEN RAISE EXCEPTION 'Non-player draft type must be text'; END IF;
   IF NEW.relation_kind='incorporated_into_later_package' THEN
     IF jsonb_typeof(NEW.terminal_outcome->'packageDescription') IS DISTINCT FROM 'string'
     THEN RAISE EXCEPTION 'Later package requires a description'; END IF;
     FOR item IN SELECT value FROM jsonb_array_elements(NEW.terminal_outcome->'onwardTransactionIds') LOOP
       IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^external-transaction:[a-f0-9]{64}$'
       THEN RAISE EXCEPTION 'Later package has an invalid onward transaction'; END IF;
     END LOOP;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_pick_terminal_outcome_guard BEFORE INSERT ON outcome_pick_realization
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_pick_terminal_outcome();

CREATE OR REPLACE FUNCTION validate_outcome_pick_realization_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE asset_pick_id TEXT; asset_kind "OutcomeAssetKind"; selection_pick_id TEXT;
BEGIN
 SELECT asset.pick_id,asset.kind INTO asset_pick_id,asset_kind FROM outcome_event_asset asset WHERE asset.asset_version_id=NEW.transfer_asset_version_id;
 IF COALESCE(asset_kind NOT IN ('current_pick','future_pick'),TRUE) OR asset_pick_id IS DISTINCT FROM NEW.pick_id
 THEN RAISE EXCEPTION 'Pick realization must connect its transferred stable entitlement'; END IF;
 IF NEW.draft_selection_id IS NOT NULL THEN
   SELECT pick_id INTO selection_pick_id FROM outcome_draft_selection WHERE selection_id=NEW.draft_selection_id;
   IF selection_pick_id IS DISTINCT FROM NEW.pick_id THEN RAISE EXCEPTION 'Pick realization selection must match its stable entitlement'; END IF;
 END IF;
 RETURN NEW;
END $$;
