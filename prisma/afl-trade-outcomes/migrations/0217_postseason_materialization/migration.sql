-- Versioned private factual records; existing v1 numerical consumers remain unchanged.
-- The expression index is intentionally SQL-owned (Prisma has no expression-index model).
CREATE UNIQUE INDEX outcome_postseason_materialization_request_key
ON outcome_private_evaluation_materialization_manifest ((manifest_json#>>'{content,requestKey}'))
WHERE manifest_json#>>'{content,schemaVersion}'='private-evaluation-materialization-manifest/v2';

CREATE FUNCTION outcome_postseason_address(prefix TEXT, content JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT prefix||':'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
$$;

CREATE FUNCTION outcome_postseason_observation_exact(c JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE req JSONB:=c#>'{request,selection}'; obs JSONB:=c#>'{observation,content}';
 review RECORD; r JSONB; policy RECORD; p JSONB; spell RECORD; sc JSONB;
 context_content JSONB; context_doc JSONB; expected JSONB; features JSONB:='[]'; outcomes JSONB:='[]';
 y INTEGER; year INTEGER; history INTEGER; i INTEGER:=0; binding JSONB; coverage RECORD; cov JSONB;
 calculation RECORD; values_json JSONB; annual JSONB; reason TEXT; subject TEXT;
 certain_start DATE; certain_end DATE; cutoff TIMESTAMPTZ:=(req->>'knowledgeCutoffAt')::TIMESTAMPTZ;
 actual_matches JSONB; review_refs JSONB;
BEGIN
 IF NOT COALESCE(cutoff<=transaction_timestamp() AND c->>'environment' IN ('test_fixture','non_production')
   AND req->>'environment'=c->>'environment',FALSE) THEN RETURN FALSE; END IF;
 SELECT * INTO review FROM outcome_review_decision WHERE decision_id=req->>'reviewDecisionId';
 IF NOT FOUND THEN RETURN FALSE; END IF;
 r:=review.evidence_json->'content';
 review_refs:=jsonb_build_array(r->'reviewEvidence');
 IF r->>'schemaVersion'='afl-trade-postseason-materialization-review/v2' THEN
   SELECT jsonb_agg(ref ORDER BY ref->>'artifactId') INTO review_refs FROM jsonb_array_elements(review_refs||jsonb_build_array(
     r#>'{valuation,componentDrawSetArtifact}',r#>'{valuation,realizedContributionLedgerArtifact}',
     r#>'{valuation,packagePolicyArtifact}',r#>'{valuation,lineageGraphArtifact}')) ref;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:postseason_materialization:'||review.subject_id,0));
 IF NOT COALESCE(review.subject_id=outcome_postseason_address('postseason-materialization-review',r)
   AND r->>'schemaVersion' IN ('afl-trade-postseason-materialization-review/v1','afl-trade-postseason-materialization-review/v2')
   AND r->>'environment'=c->>'environment' AND r->>'competition'='AFLM'
   AND r->>'authorityBoundary'='private_factual_materialization_no_numerical_admission'
   AND review.decided_at<=cutoff
   AND outcome_acquisition_registration_review_current(review.decision_id,'postseason_materialization',review.subject_id,
     review.evidence_json,(r->>'createdAt')::TIMESTAMPTZ,review.decided_at,transaction_timestamp())
   AND outcome_acquisition_registration_evidence_exact(review_refs,c->>'environment',
     (r->>'createdAt')::TIMESTAMPTZ,review.decided_at),FALSE) THEN RETURN FALSE; END IF;
 SELECT * INTO spell FROM outcome_acquisition_spell_version WHERE spell_version_id=r->>'spellVersionId' FOR SHARE;
 IF NOT FOUND OR NOT outcome_acquisition_spell_registration_current(spell.spell_version_id,transaction_timestamp()) THEN RETURN FALSE; END IF;
 sc:=spell.registration_canonical_json::JSONB;
 y:=(r->>'tradeYear')::INTEGER;
 IF NOT COALESCE(sc->>'environment'=c->>'environment' AND sc->>'competition'='AFLM'
   AND sc#>>'{entry,promotionId}'=r->>'promotionId' AND sc#>>'{entry,eventVersionId}'=r->>'eventVersionId'
   AND sc#>'{entry,eventDate}'=r->'tradeDate' AND (sc->>'createdAt')::TIMESTAMPTZ<=cutoff
   AND EXISTS (
     SELECT 1 FROM outcome_release_manifest release
     JOIN outcome_factual_release_candidate candidate ON candidate.target_release_id=release.release_id
     JOIN outcome_release_event_version member ON member.release_id=release.release_id
     JOIN outcome_event_version event ON event.event_version_id=member.event_version_id
     JOIN outcome_event root ON root.event_id=event.event_id
     JOIN outcome_release_event_asset asset ON asset.release_id=release.release_id AND asset.asset_version_id=spell.start_asset_version_id
     WHERE release.release_id=r->>'releaseId' AND release.environment::TEXT=c->>'environment'
       AND release.scope_key=r->>'scopeKey' AND candidate.status='approved' AND candidate.finalized_at<=cutoff
       AND release.created_at<=cutoff AND release.effective_through<=cutoff
       AND event.event_version_id=r->>'eventVersionId' AND event.event_id=r->>'tradeId'
       AND root.season_year=y AND root.competition='AFLM' AND event.kind='trade' AND event.status='approved'
       AND event.event_date IS NOT DISTINCT FROM (r->>'tradeDate')::DATE AND event.recorded_at<=cutoff
       AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor WHERE successor.supersedes_version_id=event.event_version_id)
       AND NOT EXISTS (SELECT 1 FROM outcome_active_release active WHERE active.release_id=release.release_id)
       AND NOT EXISTS (SELECT 1 FROM outcome_record_state_commitment state WHERE state.release_id=release.release_id
         AND state.event_revision=(SELECT max(latest.event_revision) FROM outcome_record_state_commitment latest WHERE latest.release_id=release.release_id)
         AND state.record_state_json->>'state'<>'approved')
   ),FALSE) THEN RETURN FALSE; END IF;
 context_content:=jsonb_build_object('schemaVersion','afl-trade-postseason-year-context/v1',
   'environment',r->'environment','competition',r->'competition','tradeId',r->'tradeId','promotionId',r->'promotionId',
   'eventVersionId',r->'eventVersionId','tradeYear',r->'tradeYear','tradeDate',r->'tradeDate','period',r->'period',
   'reviewDecisionId',review.decision_id,'reviewEvidence',r->'reviewEvidence',
   'recordedAt',to_char(review.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'knowledgeCutoffAt',req->'knowledgeCutoffAt','knowledgePolicy','retrospective_as_recorded_by_dataset_creation');
 context_doc:=jsonb_build_object('contextId',outcome_postseason_address('postseason-year-context',context_content),'content',context_content);
 SELECT policy_json,approval_decision_id INTO policy FROM outcome_player_pav_policy
 WHERE policy_id=req->>'policyId' AND environment::TEXT=c->>'environment' FOR SHARE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 p:=policy.policy_json->'content'; history:=(p->>'featureHistorySeasons')::INTEGER;
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:player_pav_policy:AFLM:'||(p->>'policyVersion'),0));
 IF NOT COALESCE(p->>'schemaVersion'='afl-trade-player-pav-policy/v2' AND p->>'competition'='AFLM'
   AND (p->>'fixedHorizonSeasons')::INTEGER=3 AND history BETWEEN 1 AND 3
   AND (p->>'createdAt')::TIMESTAMPTZ<=cutoff AND policy.approval_decision_id=c->>'policyApprovalDecisionId'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(p->'partitions') part WHERE y BETWEEN (part->>'fromPredictionSeason')::INTEGER AND (part->>'throughPredictionSeason')::INTEGER)
   AND EXISTS (SELECT 1 FROM outcome_review_decision decision WHERE decision.decision_id=policy.approval_decision_id
     AND decision.decision='approved' AND decision.decided_at<=cutoff
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=decision.decision_id)),FALSE) THEN RETURN FALSE; END IF;
 certain_start:=COALESCE(sc#>>'{entry,eventDate}',sc#>>'{entry,datePrecision,latestDate}')::DATE;
 certain_end:=CASE WHEN sc->'departure'='null'::JSONB THEN (sc->>'observedThrough')::DATE
   ELSE COALESCE(sc#>>'{departure,eventDate}',sc#>>'{departure,datePrecision,earliestDate}')::DATE-1 END;
 IF jsonb_array_length(c->'coverageBindings')<>history+3 THEN RETURN FALSE; END IF;
 FOR year IN y-history+1..y+3 LOOP
   binding:=c->'coverageBindings'->i; i:=i+1; reason:=NULL; cov:=NULL; values_json:='[]';
   IF (binding->>'seasonYear')::INTEGER IS DISTINCT FROM year THEN RETURN FALSE; END IF;
   subject:=(c->>'environment')||':AFLM:'||year||':'||(p->>'methodId');
   PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:postseason_season_coverage:'||subject,0));
   SELECT * INTO coverage FROM outcome_review_decision decision WHERE subject_type='postseason_season_coverage'
     AND subject_id=subject AND decision='approved' AND decided_at<=cutoff
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=decision.decision_id);
   IF FOUND AND year>=1998 THEN
     cov:=coverage.evidence_json->'content';
     IF NOT COALESCE(binding->>'reviewDecisionId'=coverage.decision_id AND binding->>'coverageId'=coverage.evidence_json->>'coverageId'
       AND binding->>'coverageId'=outcome_postseason_address('postseason-season-coverage',cov)
       AND binding->>'calculationId'=cov->>'calculationId' AND (cov->>'seasonYear')::INTEGER=year
       AND cov->>'environment'=c->>'environment' AND cov->>'competition'='AFLM' AND cov->>'methodId'=p->>'methodId'
       AND outcome_acquisition_registration_review_current(coverage.decision_id,'postseason_season_coverage',subject,coverage.evidence_json,
         (cov->>'createdAt')::TIMESTAMPTZ,coverage.decided_at,transaction_timestamp())
       AND outcome_acquisition_registration_evidence_exact(jsonb_build_array(cov->'evidence'),c->>'environment',
         (cov->>'createdAt')::TIMESTAMPTZ,coverage.decided_at),FALSE) THEN RETURN FALSE; END IF;
     SELECT calculation.* INTO calculation FROM outcome_hpn_pav_calculation calculation
       JOIN outcome_hpn_pav_calculation_head head ON head.calculation_id=calculation.calculation_id
       WHERE calculation.calculation_id=binding->>'calculationId' AND calculation.environment::TEXT=c->>'environment'
       AND calculation.competition='AFLM' AND calculation.season_year=year AND calculation.method_id=p->>'methodId'
       AND calculation.status='finalized' AND calculation.finalized_at<=cutoff AND calculation.effective_through<=cutoff
       AND calculation.calculated_at<=(cov->>'createdAt')::TIMESTAMPTZ FOR SHARE OF calculation,head;
     IF NOT FOUND THEN RETURN FALSE; END IF;
     SELECT jsonb_agg(match->'matchId' ORDER BY match->>'matchId') INTO actual_matches
       FROM outcome_hpn_pav_input_set input, jsonb_array_elements(input.input_set_json#>'{content,completedMatches}') match
       WHERE input.input_set_id=calculation.input_set_id;
     IF NOT COALESCE(cov->>'state' IN ('complete','partial') AND cov->'expectedMatchIds' @> actual_matches
       AND (cov->>'state'<>'complete' OR cov->'expectedMatchIds'=actual_matches),FALSE) THEN RETURN FALSE; END IF;
     SELECT COALESCE(jsonb_agg(jsonb_build_object('calculationId',calculation.calculation_id,'calculationSha256',calculation.calculation_sha256,
       'seasonYear',year,'effectiveThrough',calculation.calculation_json#>'{content,effectiveThrough}',
       'calculatedAt',calculation.calculation_json#>'{content,calculatedAt}','spellVersionId',player->'spellVersionId',
       'playerId',player->'playerId','playerSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(player),'UTF8')),'hex'),
       'clubId',player->'teamId','sourceRowIds',player#>'{source,sourceRowIds}','gamesPlayed',player#>'{source,gamesPlayed}',
       'offensivePav',player->'offensivePav','midfieldPav',player->'midfieldPav','defensivePav',player->'defensivePav','totalPav',player->'totalPav') ORDER BY ordinal),'[]')
       INTO values_json FROM jsonb_array_elements(calculation.calculation_json#>'{content,players}') WITH ORDINALITY item(player,ordinal)
       WHERE player->>'playerId'=sc->>'playerId' AND (year<=y OR (player->>'spellVersionId'=spell.spell_version_id AND player->>'teamId'=sc->>'clubId'));
   ELSE
     IF binding IS DISTINCT FROM jsonb_build_object('seasonYear',year,'coverageId',NULL,'reviewDecisionId',NULL,'calculationId',NULL) THEN RETURN FALSE; END IF;
   END IF;
   IF year>y AND (make_date(year,1,1)<certain_start OR make_date(year,1,1)>certain_end) THEN reason:='membership_incomplete';
   ELSIF year<1998 THEN reason:='historical_contract_unsupported';
   ELSIF cov IS NULL OR (year<=y AND cov->>'state'<>'complete') THEN reason:='season_incomplete';
   ELSIF values_json='[]'::JSONB THEN reason:='source_missing'; END IF;
   IF reason IS NOT NULL THEN annual:=jsonb_build_object('seasonYear',year,'state','unavailable','reason',reason);
   ELSE annual:=jsonb_build_object('seasonYear',year,'state',CASE WHEN cov->>'state'='complete' AND (year<=y OR make_date(year,12,31)<=certain_end) THEN 'observed' ELSE 'partial' END,
     'values',values_json,'coverageEvidence',cov->'evidence'); END IF;
   IF year<=y THEN features:=features||jsonb_build_array(annual); ELSE outcomes:=outcomes||jsonb_build_array(annual); END IF;
 END LOOP;
 expected:=jsonb_build_object('schemaVersion','afl-trade-player-pav-observation/v3','context',context_doc,'releaseId',r->'releaseId',
   'acquisitionSpell',jsonb_build_object('spellVersionId',spell.spell_version_id,'content',sc),'historySeasons',history,'features',features,'outcomes',outcomes);
 RETURN COALESCE(obs=expected AND c->'observation'=jsonb_build_object('observationId',outcome_postseason_address('player-pav-observation',expected),'content',expected)
   AND c->'selector'=jsonb_build_object('valuationScopeKey',r->'scopeKey','tradeId',r->'tradeId'),FALSE);
END;
$$;

CREATE FUNCTION validate_outcome_postseason_materialization_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE c JSONB:=NEW.manifest_json->'content'; custody RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(c->>'requestKey',0));
 SELECT * INTO custody FROM outcome_artifact_custody WHERE artifact_id=NEW.artifact_id FOR KEY SHARE;
 IF NOT FOUND OR NOT COALESCE(NEW.manifest_json=jsonb_build_object('manifestId',NEW.materialization_manifest_id,'content',c)
   AND c=jsonb_build_object('schemaVersion',c->'schemaVersion','environment',c->'environment','selector',c->'selector',
     'requestKey',c->'requestKey','request',c->'request','policyApprovalDecisionId',c->'policyApprovalDecisionId',
     'coverageBindings',c->'coverageBindings','observation',c->'observation','valuationCase',c->'valuationCase',
     'createdAt',c->'createdAt','publicationEligible',c->'publicationEligible','authorityBoundary',c->'authorityBoundary')
   AND c->'request'=jsonb_build_object('kind',c#>'{request,kind}','selection',jsonb_build_object(
     'environment',c#>'{request,selection,environment}','reviewDecisionId',c#>'{request,selection,reviewDecisionId}',
     'policyId',c#>'{request,selection,policyId}','knowledgeCutoffAt',c#>'{request,selection,knowledgeCutoffAt}'))
   AND NEW.materialization_manifest_id=outcome_postseason_address('private-evaluation-materialization-manifest',c)
   AND NEW.content_sha256=split_part(NEW.materialization_manifest_id,':',2)
   AND NEW.content_canonical_json=outcome_afl_trade_canonical_json(c)
   AND NEW.manifest_canonical_json=outcome_afl_trade_canonical_json(NEW.manifest_json)
   AND NEW.valuation_scope_key=c#>>'{selector,valuationScopeKey}' AND NEW.trade_id=c#>>'{selector,tradeId}'
   AND NEW.created_at=(c->>'createdAt')::TIMESTAMPTZ AND NEW.created_at=date_trunc('milliseconds',transaction_timestamp())
   AND c->>'requestKey'=outcome_postseason_address('postseason-materialization-request',c->'request')
   AND c->'publicationEligible'='false'::JSONB AND c->>'authorityBoundary'='private_factual_materialization_no_numerical_admission'
   AND c#>>'{request,kind}'='observation' AND c->'valuationCase'='null'::JSONB
   -- Draft boundary: enable measured/case persistence only after its SQL current-source
   -- and exact child-row guards have their end-to-end tests. Repository reads already
   -- reauthenticate those owners, but direct SQL must enforce them independently too.
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'coverageBindings') binding
     WHERE binding->'calculationId' IS DISTINCT FROM 'null'::JSONB)
   AND custody.content_sha256=encode(sha256(convert_to(NEW.manifest_canonical_json,'UTF8')),'hex')
   AND custody.artifact_id='artifact:'||custody.content_sha256 AND custody.storage_uri='artifact://sha256/'||custody.content_sha256
   AND custody.media_type='application/json' AND custody.byte_length=octet_length(convert_to(NEW.manifest_canonical_json,'UTF8'))
   AND custody.environment::TEXT=c->>'environment' AND custody.artifact_class='derived_private'
   AND custody.created_at=NEW.created_at AND custody.verified_at<=clock_timestamp()
   AND outcome_postseason_observation_exact(c),FALSE) THEN
   RAISE EXCEPTION 'Postseason materialization content or current authority differs';
 END IF;
 RETURN NEW;
END;
$$;

-- Keep the established v1 guard for every other version, including unknown versions.
DROP TRIGGER outcome_private_evaluation_materialization_manifest_insert_guard ON outcome_private_evaluation_materialization_manifest;
CREATE TRIGGER outcome_private_evaluation_materialization_manifest_insert_guard
BEFORE INSERT ON outcome_private_evaluation_materialization_manifest FOR EACH ROW
WHEN (NEW.manifest_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'private-evaluation-materialization-manifest/v2')
EXECUTE FUNCTION validate_outcome_private_evaluation_materialization_manifest_insert();
CREATE TRIGGER outcome_postseason_materialization_insert_guard
BEFORE INSERT ON outcome_private_evaluation_materialization_manifest FOR EACH ROW
WHEN (NEW.manifest_json#>>'{content,schemaVersion}'='private-evaluation-materialization-manifest/v2')
EXECUTE FUNCTION validate_outcome_postseason_materialization_insert();
