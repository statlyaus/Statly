-- Match source metrics retain appearance_fact scope; reconciled results resolve
-- the represented club from that exact immutable appearance. Season scope and
-- every remaining typed membership/finalization check stay with their owners.
DO $$
DECLARE definition TEXT;
DECLARE original TEXT := $original$
  SELECT m."player_id", m."club_scope_kind", m."club_id", m."club_scope_reason_code",
         m."match_id", m."competition", m."season_year", m."metric_code",
         m."definition_version", m."unit", m."availability", m."numeric_value", m."fact_sha256", b."environment"
    INTO source_row
    FROM "outcome_provider_numeric_metric_fact" m
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
   WHERE m."metric_fact_id" = NEW."metric_fact_id" AND b."finalized_at" IS NOT NULL AND b."status" = 'approved';
$original$;
DECLARE replacement TEXT := $replacement$
  SELECT m."player_id",
         CASE WHEN m."grain" = 'match' THEN 'resolved_single_club' ELSE m."club_scope_kind" END AS club_scope_kind,
         CASE WHEN m."grain" = 'match' THEN a."represented_club_id" ELSE m."club_id" END AS club_id,
         m."club_scope_reason_code", m."match_id", m."competition", m."season_year", m."metric_code",
         m."definition_version", m."unit", m."availability", m."numeric_value", m."fact_sha256", b."environment"
    INTO source_row
    FROM "outcome_provider_numeric_metric_fact" m
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
    LEFT JOIN "outcome_provider_player_appearance_fact" a
      ON m."grain" = 'match' AND m."club_scope_kind" = 'appearance_fact'
     AND a."appearance_fact_id" = m."appearance_fact_id"
     AND a."fact_batch_id" = m."fact_batch_id"
     AND a."normalization_run_id" = m."normalization_run_id"
     AND a."provider_decoded_row_id" = m."provider_decoded_row_id"
     AND a."player_id" = m."player_id" AND a."match_id" = m."match_id"
     AND a."competition" = m."competition" AND a."season_year" = m."season_year"
     AND m."fact_json"->>'appearanceFactId' = a."appearance_fact_id"
     AND m."fact_json"->'player' = a."fact_json"->'player'
     AND m."fact_json"->'match' = a."fact_json"->'match'
     AND m."fact_json"->'representedClub' = a."fact_json"->'representedClub'
     AND m."fact_json"#>>'{representedClub,clubId}' = a."represented_club_id"
   WHERE m."metric_fact_id" = NEW."metric_fact_id" AND b."finalized_at" IS NOT NULL AND b."status" = 'approved'
     AND (m."grain" <> 'match' OR a."appearance_fact_id" IS NOT NULL);
$replacement$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_reconciled_metric_members()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,original,'')))/length(original) <> 1 THEN
    RAISE EXCEPTION 'Expected one exact reconciled metric source projection';
  END IF;
  EXECUTE replace(definition,original,replacement);
END;
$$;
