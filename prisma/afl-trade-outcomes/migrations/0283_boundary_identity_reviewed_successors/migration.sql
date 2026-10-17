-- A reviewed identity repair of a session boundary draftee no longer voids the session proof
-- (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md, "Repairing promoted
-- draftees").
--
-- A combined-session proof (`combined_session_facts`, 0146 onwards) shows which selections bound each
-- draft session. It joins each `draft_session_boundary` claim to the candidate selection at that
-- number through the candidate's own reconciled identity resolutions for the claim's player and
-- club. Until now each resolution's review decision also had to have no successor at all. The proof
-- is re-checked on every arrival test, so a later reviewed re-target of one boundary draftee made the
-- whole draft's proof false. On the grading database, 2026-10-14, the official AFL re-target of Will
-- Hayes (pick 78, the last selection of 2018 session 2) turned all 20 reviewed v4 spells on the two
-- 2018 nights non-current. None of their players had changed.
--
-- The rule now: the cited decision is approved (unchanged), and either it has no successor
-- (unchanged), or it leads to its subject's current approved head through a chain of approved
-- revisions of the same subject and entity kind (`outcome_external_boundary_identity_decision_current`).
-- Unlike 0254's chain, a hop may name another canonical target: that is what a reviewed re-target
-- is. Any other successor still voids the proof, exactly as before: a rejection or withdrawal, a
-- generic decision without a typed identity row, a hop of another subject or entity kind, or a chain
-- whose end is not the subject's approved current head. A decision with no typed row (test_fixture
-- provenance) has no chain, so it keeps the old rule.
--
-- Why this is sound. What the proof establishes is which source selections are the first and last
-- of each session. Its inputs are the boundary claims (evidence rows of finalized batches), the
-- candidate's reconciled selections (numbers, players and clubs) and its identity resolution rows
-- (provider, source identity, canonical id, review decision). None of these can change once the
-- candidate is finalized: evidence rows are append-only under a finalized batch, reconciled children
-- are append-only under an open candidate, and a finalized candidate cannot be updated or deleted.
-- The comparison `identity.canonical_id = selection player` still reads the candidate's frozen
-- resolution, so it still compares the claim against the candidate's own reconciled view. The only
-- input that can change later is the successor chain of each cited decision. A reviewed re-target
-- says that the same source identity is another canonical player. It changes neither the boundary
-- row, nor its number, nor the candidate selection at that number, so which selections bound each
-- session is unchanged. A withdrawal or rejection removes the review the join relied on, so it still
-- voids the proof. Admission is not loosened in practice: a new candidate cites current heads, and
-- every other promotion and arrival guard still holds a re-targeted player to the 0254 chain, which
-- refuses a hop that changes the target.
--
-- Scope: the boundary player and club checks of the four session-proof functions that carry them
-- (`outcome_external_combined_draft_sessions_exact`, the v3 proof behind 2016 to 2018;
-- `outcome_external_combined_draft_group_exact`; and the two inventory variants), and
-- `outcome_session_identity_observation_current`, whose only callers are the inventory variants'
-- boundary checks. Every other exit of those functions is unchanged. Each edit is an asserted
-- in-place replacement of the deployed definition, as 0254 does.

-- Whether a session boundary's identity decision still supports the proof: no successor, or a chain
-- of approved same-subject, same-kind revisions ending at the subject's approved current head.
CREATE FUNCTION outcome_external_boundary_identity_decision_current(origin_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                     WHERE successor.supersedes_decision_id=origin_id)
  OR EXISTS (
   WITH RECURSIVE chain AS (
    SELECT typed.decision_id, typed.subject_id, typed.canonical_target_kind, 0 AS hops
      FROM outcome_external_identity_review_decision typed
      JOIN outcome_review_decision generic ON generic.decision_id=typed.decision_id
     WHERE typed.decision_id=origin_id AND typed.outcome='approved' AND generic.decision='approved'
    UNION ALL
    SELECT next.decision_id, next.subject_id, next.canonical_target_kind, chain.hops+1
      FROM chain
      JOIN outcome_external_identity_review_decision next ON next.supersedes_decision_id=chain.decision_id
      JOIN outcome_review_decision generic ON generic.decision_id=next.decision_id
     WHERE next.outcome='approved' AND generic.decision='approved'
       AND next.subject_id=chain.subject_id
       AND next.canonical_target_kind=chain.canonical_target_kind
       AND chain.hops<64
   )
   SELECT 1 FROM chain
   JOIN outcome_external_identity_resolution_head head
     ON head.subject_id=chain.subject_id AND head.decision_id=chain.decision_id
   WHERE chain.hops>0 AND head.status='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                      WHERE successor.supersedes_decision_id=chain.decision_id))
$$;

-- Replaces every match of `pattern` in one deployed function, which must match exactly `expected`
-- times and must be a session-boundary check.
CREATE FUNCTION pg_temp.replace_boundary_clause(target REGPROCEDURE, pattern TEXT, replacement TEXT,
                                                expected INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT; found INTEGER;
BEGIN
  definition:=pg_get_functiondef(target);
  found:=regexp_count(definition,pattern);
  IF found<>expected THEN
    RAISE EXCEPTION 'Expected % boundary successor clauses in %, found %', expected, target, found;
  END IF;
  EXECUTE regexp_replace(definition,pattern,replacement,'g');
END $$;

DO $migration$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'outcome_external_combined_draft_sessions_exact(text,jsonb)',
    'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
    'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)',
    'outcome_external_window_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
  ] LOOP
    IF position('draft_session_boundary' IN pg_get_functiondef(signature::regprocedure))=0 THEN
      RAISE EXCEPTION 'Expected a session-boundary check in %', signature;
    END IF;
    -- The player and the club identity of each boundary claim.
    PERFORM pg_temp.replace_boundary_clause(signature::regprocedure,
      'NOT EXISTS \(\s*SELECT 1 FROM outcome_review_decision successor\s+WHERE successor\.supersedes_decision_id=decision\.decision_id\)',
      'outcome_external_boundary_identity_decision_current(decision.decision_id)', 2);
  END LOOP;
  PERFORM pg_temp.replace_boundary_clause(
    'outcome_session_identity_observation_current(text,text,text,text)'::regprocedure,
    'NOT EXISTS\s*\(\s*SELECT 1 FROM outcome_review_decision successor\s+WHERE successor\.supersedes_decision_id=decision_key\)',
    'outcome_external_boundary_identity_decision_current(decision_key)', 1);
END $migration$;
