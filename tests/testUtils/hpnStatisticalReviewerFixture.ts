import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

/** Synthetic governed authority only; never use this seed helper with retained/shared data. */
export async function seedHpnStatisticalReviewer(
  client: AflOutcomeSqlClient,
  fixtureCase: string,
  options: {
    role?: string;
    season?: number;
    validFrom?: string;
    validThrough?: string | null;
    storedValidThrough?: string | null;
    approvedAt?: string;
    verifiedAt?: string;
  } = {}
) {
  const season = options.season ?? 2018;
  const payload = {
    fixtureCase,
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'non_production',
    principalRef: 'synthetic-reviewer',
    role: options.role ?? 'afl_trade_hpn_statistical_reviewer',
    scopeKey: `hpn-statistics:AFLM:${season}`,
    provider: 'statly_modeling',
    capabilityId: 'adjudicate_hpn_statistics',
    competition: 'AFLM',
    validFromSeason: season,
    validThroughSeason: season,
    validFrom: options.validFrom ?? '2026-09-15T00:00:00.000Z',
    validThrough: options.validThrough ?? null,
  };
  const canonical = canonicalizeAflTradeJson(payload);
  const authorityEvidenceId = createAflTradeContentAddress('reviewer-authority-evidence', payload);
  const digest = authorityEvidenceId.split(':')[1];
  const artifactId = `artifact:${digest}`;
  const approvalId = createAflTradeContentAddress('review-decision', { authorityEvidenceId });
  const at = options.approvedAt ?? '2026-09-15T00:00:00.000Z';
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
      VALUES ($1,$2,$3,'application/json',$4,'derived_private','non_production',$5,$6,'{}')`,
      [
        artifactId,
        digest,
        `artifact://sha256/${digest}`,
        Buffer.byteLength(canonical),
        at,
        options.verifiedAt ?? at,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES ($1,'governed_evidence_reference',$2,'approved','Synthetic statistical reviewer fixture',
       jsonb_build_object('referenceSha256',$3::text),'fixture-governance-reviewer',$4)`,
      [approvalId, authorityEvidenceId, digest, at]
    );
    await transaction.query(
      `INSERT INTO outcome_governed_evidence_reference
      (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,
       created_at,evidence_canonical_json,evidence_json)
      VALUES ($1,$2,'reviewer_authority_evidence',$3,'non_production','approved',$4,$5,$6::text,($6::text)::jsonb)`,
      [authorityEvidenceId, digest, artifactId, approvalId, at, canonical]
    );
    await transaction.query(
      `INSERT INTO outcome_operational_principal_authority
      (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,
       valid_from_season,valid_through_season,valid_from,valid_through)
      VALUES ($1,$2,$3,$4,'statly_modeling','adjudicate_hpn_statistics','AFLM',$5,$5,$6,$7)`,
      [
        authorityEvidenceId,
        payload.principalRef,
        payload.role,
        payload.scopeKey,
        season,
        payload.validFrom,
        options.storedValidThrough === undefined
          ? payload.validThrough
          : options.storedValidThrough,
      ]
    );
    await finishAsNonproductionGovernance(transaction);
  });
  return {
    approvalId,
    context: {
      environment: 'non_production' as const,
      principalRef: payload.principalRef,
      authorityEvidenceId,
    },
  };
}

export async function finishAsNonproductionGovernance(transaction: AflOutcomeSqlTransaction) {
  const scope = await transaction.query<{ schema_name: string }>(
    'SELECT current_schema() AS schema_name'
  );
  await transaction.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
  await transaction.query("SELECT set_config('search_path',$1,TRUE)", [scope.rows[0].schema_name]);
}
