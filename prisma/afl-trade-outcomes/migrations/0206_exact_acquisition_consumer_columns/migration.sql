-- Dataset rows name their spell reference differently from metric/release consumers.
-- Preserve the v2 exclusion: this repair does not qualify interval-aware consumers.
CREATE OR REPLACE FUNCTION require_outcome_exact_acquisition_consumer()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE referenced_spell_version_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'outcome_valuation_dataset_row' THEN
    referenced_spell_version_id := NEW.acquisition_spell_version_id;
  ELSE
    referenced_spell_version_id := NEW.spell_version_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM outcome_acquisition_spell_version spell
    WHERE spell.spell_version_id = referenced_spell_version_id
      AND spell.registration_canonical_json::JSONB->>'schemaVersion' = 'afl-trade-acquisition-registration/v2'
  ) THEN
    RAISE EXCEPTION 'Window acquisition requires interval-aware metric and release qualification';
  END IF;
  RETURN NEW;
END $$;
