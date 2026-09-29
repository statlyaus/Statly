-- Governed, versioned enrichment of canonical draft picks.
--
-- outcome_draft_pick is append-only. A session-only promotion stores each selected pick with its
-- round, nominal pick number and original club empty, because a completed draft session does not
-- state them. A later reviewed pick-lineage promotion reuses the exercised pick's stable pick_id and
-- does know those facts; before this migration it could only fail with IMMUTABLE_CONFLICT.
--
-- This migration keeps outcome_draft_pick immutable and adds an append-only version chain:
--  1. Each enrichment row stores the cumulative resolved facts for one pick at one version, the
--     promotion and approval decision it came from, and the reviewed pick-lineage registration that
--     evidences it (the candidate's reviewed scope/correction registration, or a registration made
--     against the promoted candidate itself), which must still hold its current approval. It may only fill fields that are empty in the currently resolved facts; a known
--     value can never change. Versions are gap-free and each supersedes exactly its predecessor.
--  2. outcome_draft_pick_facts(pick_ids, as_of) resolves the facts current at an instant (NULL means
--     now). Release-bound readers pass the release's effective_through so that an enrichment recorded
--     after a release never rewrites that release's reconstruction.
--  3. Pick-PAV finalization resolves pick facts through the same function at its release cutoff, so
--     the reader and validator agree. The edit is fragment-asserted against the deployed definition.

CREATE TABLE outcome_draft_pick_enrichment (
  enrichment_id TEXT PRIMARY KEY CHECK (enrichment_id ~ '^draft-pick-enrichment:[a-f0-9]{64}$'),
  pick_id TEXT NOT NULL REFERENCES outcome_draft_pick(pick_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_enrichment_id TEXT UNIQUE REFERENCES outcome_draft_pick_enrichment(enrichment_id) ON DELETE RESTRICT,
  nominal_round INTEGER CHECK (nominal_round IS NULL OR nominal_round > 0),
  nominal_pick INTEGER CHECK (nominal_pick IS NULL OR nominal_pick > 0),
  original_club_id TEXT REFERENCES outcome_club(club_id) ON DELETE RESTRICT,
  promotion_id TEXT NOT NULL REFERENCES outcome_external_canonical_promotion(promotion_id) ON DELETE RESTRICT,
  approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  registration_id TEXT NOT NULL REFERENCES outcome_reviewed_pick_lineage_registration(registration_id) ON DELETE RESTRICT,
  source_json JSONB NOT NULL CHECK (jsonb_typeof(source_json) = 'object'),
  recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (pick_id, version),
  UNIQUE (pick_id, promotion_id)
);

CREATE TRIGGER outcome_draft_pick_enrichment_append_only
BEFORE UPDATE OR DELETE ON outcome_draft_pick_enrichment
FOR EACH ROW EXECUTE FUNCTION reject_outcome_authority_mutation();

CREATE FUNCTION outcome_draft_pick_facts(pick_ids TEXT[], as_of TIMESTAMPTZ)
RETURNS TABLE (
  pick_id TEXT,
  draft_season_year INTEGER,
  draft_kind "OutcomeEventKind",
  nominal_round INTEGER,
  nominal_pick INTEGER,
  original_club_id TEXT,
  status "OutcomeRecordStatus",
  enrichment_id TEXT,
  enrichment_version INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT pick.pick_id, pick.draft_season_year, pick.draft_kind,
         COALESCE(pick.nominal_round, latest.nominal_round),
         COALESCE(pick.nominal_pick, latest.nominal_pick),
         COALESCE(pick.original_club_id, latest.original_club_id),
         pick.status, latest.enrichment_id, latest.version
    FROM outcome_draft_pick pick
    LEFT JOIN LATERAL (
      SELECT enrichment.enrichment_id, enrichment.version, enrichment.nominal_round,
             enrichment.nominal_pick, enrichment.original_club_id
        FROM outcome_draft_pick_enrichment enrichment
       WHERE enrichment.pick_id = pick.pick_id
         AND (as_of IS NULL OR enrichment.recorded_at <= as_of)
       ORDER BY enrichment.version DESC
       LIMIT 1
    ) latest ON TRUE
   WHERE pick.pick_id = ANY(pick_ids)
$$;

CREATE FUNCTION validate_outcome_draft_pick_enrichment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  base outcome_draft_pick%ROWTYPE;
  prior outcome_draft_pick_enrichment%ROWTYPE;
  promotion RECORD;
  before_round INTEGER; before_pick INTEGER; before_club TEXT;
BEGIN
  SELECT * INTO base FROM outcome_draft_pick WHERE pick_id = NEW.pick_id FOR SHARE;
  IF NOT FOUND OR base.status <> 'approved'::"OutcomeRecordStatus" THEN
    RAISE EXCEPTION 'Pick enrichment requires one approved canonical pick';
  END IF;
  SELECT * INTO prior FROM outcome_draft_pick_enrichment
   WHERE pick_id = NEW.pick_id ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NEW.version IS DISTINCT FROM COALESCE(prior.version, 0) + 1
     OR NEW.supersedes_enrichment_id IS DISTINCT FROM prior.enrichment_id THEN
    RAISE EXCEPTION 'Pick enrichment must extend the current version exactly once';
  END IF;
  before_round := COALESCE(base.nominal_round, prior.nominal_round);
  before_pick := COALESCE(base.nominal_pick, prior.nominal_pick);
  before_club := COALESCE(base.original_club_id, prior.original_club_id);
  IF (before_round IS NOT NULL AND NEW.nominal_round IS DISTINCT FROM before_round)
     OR (before_pick IS NOT NULL AND NEW.nominal_pick IS DISTINCT FROM before_pick)
     OR (before_club IS NOT NULL AND NEW.original_club_id IS DISTINCT FROM before_club) THEN
    RAISE EXCEPTION 'Pick enrichment cannot change a known canonical pick fact';
  END IF;
  IF (NEW.nominal_round IS NOT DISTINCT FROM before_round)
     AND (NEW.nominal_pick IS NOT DISTINCT FROM before_pick)
     AND (NEW.original_club_id IS NOT DISTINCT FROM before_club) THEN
    RAISE EXCEPTION 'Pick enrichment must fill at least one empty canonical pick fact';
  END IF;
  SELECT p.candidate_id, p.approval_decision_id, candidate.candidate_json INTO promotion
    FROM outcome_external_canonical_promotion p
    JOIN outcome_external_reconciliation_candidate candidate ON candidate.candidate_id = p.candidate_id
   WHERE p.promotion_id = NEW.promotion_id FOR SHARE OF p;
  IF NOT FOUND OR promotion.approval_decision_id IS DISTINCT FROM NEW.approval_decision_id
     OR NEW.registration_id IS DISTINCT FROM COALESCE(
          promotion.candidate_json #>> '{content,reviewedCorrection,registrationId}',
          promotion.candidate_json #>> '{content,reviewedScope,registrationId}',
          (SELECT registration.registration_id FROM outcome_reviewed_pick_lineage_registration registration
            WHERE registration.candidate_id = promotion.candidate_id))
     OR NEW.source_json ->> 'candidateId' IS DISTINCT FROM promotion.candidate_id THEN
    RAISE EXCEPTION 'Pick enrichment must bind its promotion, approval and reviewed lineage';
  END IF;
  -- The supporting reviewed lineage must still hold its exact current approval.
  PERFORM read_outcome_reviewed_pick_lineage(NEW.registration_id);
  RETURN NEW;
END $$;

CREATE TRIGGER outcome_draft_pick_enrichment_validate
BEFORE INSERT ON outcome_draft_pick_enrichment
FOR EACH ROW EXECUTE FUNCTION validate_outcome_draft_pick_enrichment();

DO $migration$
DECLARE
  definition TEXT;
  old_fragment CONSTANT TEXT := $old$LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id"=selection."pick_id"$old$;
  new_fragment CONSTANT TEXT := $new$LEFT JOIN LATERAL outcome_draft_pick_facts(ARRAY[selection."pick_id"],
        (SELECT manifest."effective_through" FROM "outcome_release_manifest" manifest
          WHERE manifest."release_id"=NEW."release_id")) pick ON pick."pick_id"=selection."pick_id"$new$;
BEGIN
  definition := pg_get_functiondef('validate_outcome_pick_pav_finalization()'::regprocedure);
  IF (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment) <> 1 THEN
    RAISE EXCEPTION 'Expected pick-PAV finalization pick join fragment exactly once';
  END IF;
  EXECUTE replace(definition, old_fragment, new_fragment);
  definition := pg_get_functiondef('validate_outcome_pick_pav_finalization()'::regprocedure);
  IF position(old_fragment IN definition) > 0 OR position('outcome_draft_pick_facts' IN definition) = 0 THEN
    RAISE EXCEPTION 'Pick-PAV finalization did not adopt resolved pick facts';
  END IF;
END $migration$;

-- The dispatch-bound pick-PAV coordinator already reads outcome_draft_pick (0087); it resolves the
-- same facts through outcome_draft_pick_facts and needs the enrichment chain as well.
GRANT SELECT ON "outcome_draft_pick_enrichment" TO afl_trade_private_evaluation_coordinator;
