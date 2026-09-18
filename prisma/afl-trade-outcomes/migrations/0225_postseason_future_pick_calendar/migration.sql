-- Replace the v2 exact-case validator so authenticated supported future picks are admitted only
-- when their canonical draft season is inside the original trade's Y+1 through Y+3 calendar.
CREATE OR REPLACE FUNCTION outcome_postseason_valuation_case_exact(c JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE r JSONB; docs JSONB:=c->'valuationParents'; draws JSONB:=docs#>'{componentDrawSet,content}';
 ledger JSONB:=docs#>'{realizedContributionLedger,content}'; policy JSONB:=docs#>'{packagePolicy,content}';
 graph JSONB:=docs->'lineageGraph'; expected JSONB; parties JSONB; actual_ids JSONB; parent_ids JSONB;
 asset RECORD; component JSONB; root JSONB; item JSONB; cutoff TIMESTAMPTZ:=(c#>>'{request,selection,knowledgeCutoffAt}')::TIMESTAMPTZ;
 later_at TIMESTAMPTZ; y INTEGER; expected_kind TEXT; pick_year INTEGER; canonical_graph JSONB; collection TEXT; key_name TEXT; custody_at TIMESTAMPTZ; custodians JSONB;
BEGIN
 SELECT evidence_json->'content' INTO r FROM outcome_review_decision
 WHERE decision_id=c#>>'{request,selection,reviewDecisionId}' FOR SHARE;
 IF NOT FOUND OR r->>'schemaVersion' IS DISTINCT FROM 'afl-trade-postseason-materialization-review/v2'
   OR c#>>'{request,kind}' IS DISTINCT FROM 'complete_trade'
   OR NOT outcome_postseason_valuation_parent_bytes_exact(docs,r->'valuation',c->>'environment',(r->>'createdAt')::TIMESTAMPTZ)
 THEN RETURN FALSE; END IF;
 canonical_graph:='{}'::JSONB;
 FOREACH collection IN ARRAY ARRAY['assets','custodySpells','edges','dispositions','corrections'] LOOP
   key_name:=CASE collection WHEN 'assets' THEN 'assetId' WHEN 'custodySpells' THEN 'custodySpellId'
     WHEN 'edges' THEN 'edgeId' WHEN 'dispositions' THEN 'dispositionId' WHEN 'corrections' THEN 'correctionId' END;
   SELECT canonical_graph||jsonb_build_object(collection,COALESCE(jsonb_agg(value ORDER BY value->>key_name),'[]'))
     INTO canonical_graph FROM jsonb_array_elements(graph->collection);
 END LOOP;
 y:=(r->>'tradeYear')::INTEGER; later_at:=(r#>>'{valuation,laterEffectiveAt}')::TIMESTAMPTZ;
 custody_at:=CASE WHEN r->>'tradeDate' IS NOT NULL THEN (r->>'tradeDate')::DATE::TIMESTAMP AT TIME ZONE 'UTC'
   ELSE make_date(y+1,1,1)::TIMESTAMP AT TIME ZONE 'UTC' END;

 IF NOT COALESCE(draws->>'schemaVersion'='afl-trade-component-draw-set/v1'
   AND ledger->>'schemaVersion'='afl-trade-realized-contribution-ledger/v1'
   AND policy->>'schemaVersion'='afl-trade-package-policy/v1'
   AND docs#>>'{componentDrawSet,componentDrawSetId}'=outcome_postseason_address('component-draw-set',draws)
   AND docs#>>'{realizedContributionLedger,realizedContributionLedgerId}'=outcome_postseason_address('realized-contribution-ledger',ledger)
   AND docs#>>'{packagePolicy,packagePolicyId}'=outcome_postseason_address('package-policy',policy)
   AND ledger->>'lineageGraphId'=outcome_postseason_address('lineage-graph',canonical_graph)
   AND ledger->'valuationBundleId'=draws->'valuationBundleId' AND policy->'valuationBundleId'=draws->'valuationBundleId'
   AND ledger->'valuationInputBundleId' IS NOT DISTINCT FROM draws->'valuationInputBundleId'
   AND policy->'valuationInputBundleId' IS NOT DISTINCT FROM draws->'valuationInputBundleId'
   AND ledger->'valueUnitId'=draws->'valueUnitId' AND policy->'valueUnitId'=draws->'valueUnitId'
   AND (later_at AT TIME ZONE 'UTC')::DATE>COALESCE((r->>'tradeDate')::DATE,make_date(y,12,31))
   AND later_at<=cutoff,FALSE) THEN RETURN FALSE; END IF;
 PERFORM 1 FROM outcome_event_party WHERE event_version_id=r->>'eventVersionId' FOR SHARE;
 PERFORM 1 FROM outcome_event_asset WHERE event_version_id=r->>'eventVersionId' FOR SHARE;
 PERFORM 1 FROM outcome_club WHERE club_id IN (SELECT club_id FROM outcome_event_party WHERE event_version_id=r->>'eventVersionId') FOR SHARE;
 SELECT jsonb_agg(asset_version_id ORDER BY asset_version_id) INTO actual_ids FROM outcome_event_asset
 WHERE event_version_id=r->>'eventVersionId' AND status='approved';
 SELECT jsonb_agg(value->>'assetId' ORDER BY value->>'assetId') INTO parent_ids FROM jsonb_array_elements(draws->'assets');
 IF actual_ids IS NULL OR actual_ids IS DISTINCT FROM parent_ids THEN RETURN FALSE; END IF;
 FOR asset IN SELECT * FROM outcome_event_asset WHERE event_version_id=r->>'eventVersionId' AND status='approved' LOOP
   IF NOT EXISTS(SELECT 1 FROM outcome_release_event_asset WHERE release_id=r->>'releaseId' AND asset_version_id=asset.asset_version_id)
     OR NOT EXISTS(SELECT 1 FROM outcome_event_party WHERE event_version_id=asset.event_version_id AND club_id=asset.from_club_id)
     OR NOT EXISTS(SELECT 1 FROM outcome_event_party WHERE event_version_id=asset.event_version_id AND club_id=asset.to_club_id)
     OR asset.from_club_id=asset.to_club_id THEN RETURN FALSE; END IF;
   SELECT jsonb_agg(value->>'aflClubId') INTO custodians FROM jsonb_array_elements(graph->'custodySpells')
     WHERE value->>'assetId'=asset.asset_version_id
       AND (value->>'effectiveFrom')::TIMESTAMPTZ<=custody_at
       AND (value->>'effectiveTo' IS NULL OR custody_at<(value->>'effectiveTo')::TIMESTAMPTZ)
       AND (value->>'knownFrom')::TIMESTAMPTZ<=cutoff
       AND (value->>'knownTo' IS NULL OR cutoff<(value->>'knownTo')::TIMESTAMPTZ);
   IF custodians IS DISTINCT FROM jsonb_build_array(asset.to_club_id) THEN RETURN FALSE; END IF;
   SELECT value INTO component FROM jsonb_array_elements(draws->'assets') WHERE value->>'assetId'=asset.asset_version_id;
   SELECT value INTO root FROM jsonb_array_elements(graph->'assets') WHERE value->>'assetId'=asset.asset_version_id;
   expected_kind:=CASE asset.kind::TEXT WHEN 'player' THEN 'player' WHEN 'current_pick' THEN 'current_pick_entitlement'
     WHEN 'future_pick' THEN 'future_pick_entitlement' WHEN 'cash' THEN 'unsupported_consideration'
     WHEN 'list_right' THEN 'unsupported_consideration' WHEN 'other' THEN 'unsupported_consideration' END;
   IF NOT COALESCE(root->>'assetType'=expected_kind AND component->>'assetKind'=expected_kind
     AND component->>'status' IN ('supported','excluded')
     AND (expected_kind<>'unsupported_consideration' OR component->>'status'='excluded'),FALSE) THEN RETURN FALSE; END IF;
   IF expected_kind='future_pick_entitlement' AND component->>'status'='supported' THEN
     SELECT draft_season_year INTO pick_year FROM outcome_draft_pick WHERE pick_id=asset.pick_id FOR SHARE;
     IF NOT FOUND OR pick_year NOT BETWEEN y+1 AND y+3 THEN RETURN FALSE; END IF;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM outcome_event_party party WHERE party.event_version_id=r->>'eventVersionId'
   AND NOT EXISTS(SELECT 1 FROM outcome_event_asset received WHERE received.event_version_id=party.event_version_id AND received.status='approved' AND received.to_club_id=party.club_id))
 THEN RETURN FALSE; END IF;
 SELECT jsonb_agg(jsonb_build_object('aflClubId',party.club_id,'clubName',club.current_name,
   'receivedRootAssetIds',(SELECT jsonb_agg(asset_version_id ORDER BY asset_version_id) FROM outcome_event_asset
     WHERE event_version_id=party.event_version_id AND status='approved' AND to_club_id=party.club_id)) ORDER BY party.club_id)
 INTO parties FROM outcome_event_party party JOIN outcome_club club USING(club_id) WHERE event_version_id=r->>'eventVersionId';
 IF jsonb_array_length(parties)<2 THEN RETURN FALSE; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(ledger->'records') LOOP
   IF NOT EXISTS(SELECT 1 FROM outcome_event_asset WHERE event_version_id=r->>'eventVersionId' AND status='approved'
     AND asset_version_id=item->>'rootAssetId' AND to_club_id=item->>'aflClubId')
     OR NOT COALESCE((item->>'periodStartAt')::TIMESTAMPTZ>=make_date(y+1,1,1)::TIMESTAMP AT TIME ZONE 'UTC'
       AND (item->>'periodEndAt')::TIMESTAMPTZ<=make_date(y+4,1,1)::TIMESTAMP AT TIME ZONE 'UTC'
       AND (item->>'periodEndAt')::TIMESTAMPTZ<=later_at AND (item->>'knownFrom')::TIMESTAMPTZ<=cutoff,FALSE)
   THEN RETURN FALSE; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(draws->'draws') d,
   jsonb_array_elements(d->'assetOutcomes') a,jsonb_array_elements(a->'forecasts') f,jsonb_array_elements(f->'seasons') season
   WHERE NOT COALESCE((season->>'seasonOffset')::INTEGER BETWEEN 0 AND 2,FALSE)) THEN RETURN FALSE; END IF;
 expected:=jsonb_build_object('schemaVersion','afl-trade-valuation-case/v2',
   'publicAssetBoundary','source_native_afl_assets_no_user_or_fantasy_ownership','calculationUnit','complete_multi_party_trade',
   'tradeId',r->'tradeId','context',c#>'{observation,content,context}',
   'valuationBundleId',draws->'valuationBundleId','lineageGraphId',ledger->'lineageGraphId',
   'componentDrawSetId',docs#>'{componentDrawSet,componentDrawSetId}',
   'realizedContributionLedgerId',docs#>'{realizedContributionLedger,realizedContributionLedgerId}',
   'packagePolicyId',docs#>'{packagePolicy,packagePolicyId}','valueUnitId',draws->'valueUnitId','parties',parties,
   'outcomeSeasons',jsonb_build_array(y+1,y+2,y+3),
   'laterAssessment',jsonb_build_object('effectiveAt',r#>'{valuation,laterEffectiveAt}',
     'knowledgeCutoffAt',c#>'{request,selection,knowledgeCutoffAt}','valuationAsOf',c#>'{request,selection,knowledgeCutoffAt}'),
   'legacySourceMetricsTreatment','excluded_from_calculation_retained_only_by_separate_legacy_projection');
 IF draws ? 'valuationInputBundleId' THEN expected:=expected||jsonb_build_object('valuationInputBundleId',draws->'valuationInputBundleId'); END IF;
 RETURN COALESCE(c->'valuationCase'=jsonb_build_object('valuationCaseId',outcome_postseason_address('valuation-case',expected),'content',expected),FALSE);
END;
$$;
