-- v1 keeps its retained factual release parent. v2 player observations are not
-- the target trade cohort: resolve that release only through the authenticated
-- independent cohort binding. Preserve every existing factual/model/head fence.
DO $cohort_parent$
DECLARE definition TEXT; old_join TEXT; new_join TEXT; old_projection TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'load_outcome_private_prepared_v3_authority(text)'::regprocedure
  ) INTO definition;
  old_projection:=$old$         factual."factual_release_id",
         factual."output_id",$old$;
  old_join:=$old$    JOIN "outcome_release_manifest" release
      ON release."release_id"=factual."factual_release_id"
     AND release."environment"='non_production'$old$;
  new_join:=$new$    CROSS JOIN LATERAL (
      SELECT CASE factual."output_json"#>>'{content,schemaVersion}'
        WHEN 'afl-trade-private-valuation-factual-output/v1' THEN
          factual."factual_release_id"
        WHEN 'afl-trade-private-valuation-factual-output/v2' THEN
          "load_outcome_private_valuation_cohort_input"(request."request_id")
            ->>'cohortReleaseId'
        ELSE NULL
      END AS release_id
    ) cohort_parent
    JOIN "outcome_release_manifest" release
      ON release."release_id"=cohort_parent.release_id
     AND release."environment"='non_production'$new$;
  IF definition IS NULL
     OR (length(definition)-length(replace(definition,old_join,'')))/length(old_join)<>1
     OR (length(definition)-length(replace(definition,old_projection,'')))/length(old_projection)<>1 THEN
    RAISE EXCEPTION 'Expected private prepared-v3 cohort-parent fragments were not found exactly once';
  END IF;
  EXECUTE replace(replace(definition,old_join,new_join),old_projection,
    $new$         release."release_id",
         factual."output_id",$new$);
END $cohort_parent$;
