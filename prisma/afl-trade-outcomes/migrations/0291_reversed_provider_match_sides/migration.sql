-- A match proposal may declare providerSideCorrespondence 'reversed' when the provider lists the fixture
-- the other way round from the canonical match (2015 Grand Final: Footywire home Hawthorn, AFL Tables
-- home West Coast). The canonical home club must then be backed by the provider's away-side club
-- resolution and the canonical away club by its home side, both when a resolution is persisted and when
-- a reviewed canonical match is registered. Without the declaration nothing changes.
CREATE FUNCTION outcome_0291_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT,expected_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE definition TEXT; occurrences INTEGER; BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF definition IS NULL OR occurrences<>expected_count THEN RAISE EXCEPTION 'Expected % side fragments in %, found %',expected_count,signature,occurrences; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

SELECT outcome_0291_replace_fragment('validate_outcome_provider_resolution_insert()',
  'r.side=''home'' AND r.club_id=target_json->>''homeClubId''',
  'r.side=(CASE WHEN target_json->>''providerSideCorrespondence''=''reversed'' THEN ''away'' ELSE ''home'' END) AND r.club_id=target_json->>''homeClubId''',1);
SELECT outcome_0291_replace_fragment('validate_outcome_provider_resolution_insert()',
  'r.side=''away'' AND r.club_id=target_json->>''awayClubId''',
  'r.side=(CASE WHEN target_json->>''providerSideCorrespondence''=''reversed'' THEN ''home'' ELSE ''away'' END) AND r.club_id=target_json->>''awayClubId''',1);
SELECT outcome_0291_replace_fragment('register_outcome_reviewed_canonical_target(text,text,text,text)',
  'AND resolution.side=match_side',
  'AND resolution.side=(CASE WHEN target->>''providerSideCorrespondence''=''reversed'' THEN (CASE match_side WHEN ''home'' THEN ''away'' ELSE ''home'' END) ELSE match_side END)',1);
DROP FUNCTION outcome_0291_replace_fragment(TEXT,TEXT,TEXT,INTEGER);
