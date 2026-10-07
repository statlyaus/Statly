-- Same-player identity successor chains.
--
-- A promoted draft asset and a draft selection record the external identity decision that resolved
-- their player (external_identity_decision_id). Seven checks required that decision to still be the
-- subject's current head: the promoted-event and arrival-event functions behind reviewed spells, the
-- canonical-identity trigger on asset inserts, the two release-membership validators and the two
-- special-entitlement lifecycle authenticators. A later review of the same subject supersedes the
-- decision and moves the head, so on 2026-10-06 one re-confirmation pass that changed no player made
-- 225 assets and 224 selections, and every reviewed spell on them, fail those checks.
--
-- Owner decision (statlyaus/Statly#742, 2026-10-07, option b): every such check accepts the recorded
-- decision when it leads, through supersedes_decision_id, to the subject's current approved head with
-- the same canonical target. The loosening is deliberate: a later same-player decision, possibly under
-- a different reviewer authority, keeps earlier promotions, releases, entitlements and spells valid.
-- The identity cannot drift: a hop that changes canonical_target_kind or canonical_target_id, a
-- rejected or withdrawn hop, or a head that is not approved breaks the chain, and the check then runs
-- against the recorded decision exactly as before, where its "not superseded" condition refuses it.
-- Decisions with no typed row (test_fixture provenance) have no chain and are unchanged.
--
-- The promotion-time resolution row and the reviewer-authority check stay bound to the recorded
-- decision; only the head and its review are read from the end of the chain. Every edit below is an
-- asserted in-place replacement of the deployed definition, as 0247, 0248 and 0252 do.

CREATE FUNCTION outcome_external_identity_current_decision(origin_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
 WITH RECURSIVE chain AS (
  SELECT typed.decision_id, typed.subject_id, typed.canonical_target_kind, typed.canonical_target_id, 0 AS hops
  FROM outcome_external_identity_review_decision typed
  WHERE typed.decision_id=origin_id AND typed.outcome='approved'
  UNION ALL
  SELECT next.decision_id, next.subject_id, next.canonical_target_kind, next.canonical_target_id, chain.hops+1
  FROM chain
  JOIN outcome_external_identity_review_decision next ON next.supersedes_decision_id=chain.decision_id
  WHERE next.outcome='approved' AND next.subject_id=chain.subject_id
    AND next.canonical_target_kind=chain.canonical_target_kind
    AND next.canonical_target_id=chain.canonical_target_id
    AND chain.hops<64
 )
 SELECT chain.decision_id FROM chain
 JOIN outcome_external_identity_resolution_head head
   ON head.subject_id=chain.subject_id AND head.decision_id=chain.decision_id
 JOIN outcome_review_decision generic ON generic.decision_id=chain.decision_id
 WHERE head.status='approved' AND generic.decision='approved'
   AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                    WHERE successor.supersedes_decision_id=chain.decision_id)
 LIMIT 1
$$;

-- Replaces `old` with `new` in one deployed function. Each fragment must occur exactly once.
CREATE FUNCTION pg_temp.replace_identity_clause(target REGPROCEDURE, old TEXT, new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,old),1)<>2 THEN
    RAISE EXCEPTION 'Expected exactly one identity fragment in %: %', target, old;
  END IF;
  EXECUTE replace(definition,old,new);
END $$;

DO $migration$
DECLARE fn TEXT;
BEGIN
 -- 1, 2: the promoted-event check (v1, v2 and v3 spells) and its arrival-only copy (v4 spells).
 FOREACH fn IN ARRAY ARRAY[
   'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
   'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'] LOOP
   -- The head is reached through the chain. The reviewer authority stays that of the recorded
   -- (promotion-time) decision: a later same-player review may be under another authority.
   PERFORM pg_temp.replace_identity_clause(fn::regprocedure,
     $old$      JOIN outcome_external_identity_resolution_head identity_head ON identity_head.decision_id=decision.decision_id
      JOIN outcome_review_decision generic ON generic.decision_id=decision.decision_id$old$,
     $new$      JOIN outcome_external_identity_resolution_head identity_head ON identity_head.decision_id=outcome_external_identity_current_decision(decision.decision_id)
      JOIN outcome_review_decision head_review ON head_review.decision_id=identity_head.decision_id
      JOIN outcome_review_decision generic ON generic.decision_id=decision.decision_id$new$);
   PERFORM pg_temp.replace_identity_clause(fn::regprocedure,
     $old$        AND decision.outcome='approved' AND identity_head.status='approved' AND generic.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=generic.decision_id)$old$,
     $new$        AND decision.outcome='approved' AND identity_head.status='approved' AND generic.decision='approved'
        AND head_review.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=head_review.decision_id)$new$);
 END LOOP;

 -- 3: the canonical-identity trigger on promoted asset inserts.
 PERFORM pg_temp.replace_identity_clause('validate_outcome_external_canonical_identity_decision()'::regprocedure,
   $old$   WHERE decision.decision_id=NEW.external_identity_decision_id;$old$,
   $new$   WHERE decision.decision_id=COALESCE(outcome_external_identity_current_decision(NEW.external_identity_decision_id),NEW.external_identity_decision_id);$new$);

 -- 4, 5: release membership validators, asset and selection clauses.
 FOREACH fn IN ARRAY ARRAY[
   'validate_outcome_release_event_version_membership()',
   'validate_outcome_release_membership()'] LOOP
   PERFORM pg_temp.replace_identity_clause(fn::regprocedure,
     $old$WHERE review."decision_id" = asset."external_identity_decision_id"$old$,
     $new$WHERE review."decision_id" = COALESCE("outcome_external_identity_current_decision"(asset."external_identity_decision_id"), asset."external_identity_decision_id")$new$);
   PERFORM pg_temp.replace_identity_clause(fn::regprocedure,
     $old$WHERE review."decision_id" = selection."external_identity_decision_id"$old$,
     $new$WHERE review."decision_id" = COALESCE("outcome_external_identity_current_decision"(selection."external_identity_decision_id"), selection."external_identity_decision_id")$new$);
 END LOOP;

 -- 6, 7: special entitlement lifecycle authenticators.
 FOREACH fn IN ARRAY ARRAY[
   'authenticate_outcome_special_entitlement_lifecycle(jsonb,text)',
   'authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)'] LOOP
   PERFORM pg_temp.replace_identity_clause(fn::regprocedure,
     $old$SELECT 1 FROM outcome_review_decision review WHERE review.decision_id=selection.external_identity_decision_id$old$,
     $new$SELECT 1 FROM outcome_review_decision review WHERE review.decision_id=COALESCE(outcome_external_identity_current_decision(selection.external_identity_decision_id),selection.external_identity_decision_id)$new$);
 END LOOP;
END $migration$;

DROP FUNCTION pg_temp.replace_identity_clause(REGPROCEDURE, TEXT, TEXT);
