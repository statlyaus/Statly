// @vitest-environment node

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeHpnPlayerFieldMapCandidate } from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const MIGRATION = readFileSync(
  new URL(
    '../../prisma/afl-trade-outcomes/migrations/0052_hpn_projected_field_map_authority/migration.sql',
    import.meta.url
  ),
  'utf8'
);
const candidateAt = '2026-08-16T04:00:00.000Z';
const decidedAt = '2026-08-16T05:00:00.000Z';

async function prepareDatabase(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture','non_production','production');
  `);
  await database.exec(MIGRATION);
}

class PgliteSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly db: PGlite) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.db.query<Row>(sql, [...parameters]);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const result = await work(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function approvedProjection(input: { readonly decision: 'approved' | 'rejected'; readonly rationale: string }) {
  const providerDecodeMap = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
  const candidate = createLocalAflTradeHpnPlayerFieldMapCandidate({
    provider: 'afl_tables',
    seasonYear: 2025,
    providerDecodeMap,
    providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
      providerDecodeMap,
      candidateAt
    ),
    createdAt: candidateAt,
  });
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, candidateAt);
  const sourceUseContent = {
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1' as const,
    environment: 'non_production' as const,
    purpose: 'private_confirmed_realized_hpn_pav' as const,
    competition: 'AFLM',
    seasonYear: 2025,
    valuationScopeKey: 'workbook:2025',
    evaluationDecisionId: 'private-reviewed-evaluation-decision:fixture',
    state: 'permitted_private_calculation' as const,
    rightsArtifactId: `artifact:${'1'.repeat(64)}`,
    evidenceBundleId: 'private-reviewed-evidence:fixture',
    fields: [...new Set(
      candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
    )].sort().map((sourceField) => ({
      sourceField,
      state: 'permitted_private_calculation' as const,
      reasons: [],
    })),
    reasons: [],
    evidenceRefs: [],
    evaluatedAt: candidateAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  const sourceUseAssessment = {
    assessmentId: createAflTradeContentAddress(
      'hpn-private-source-use-assessment',
      sourceUseContent
    ),
    content: sourceUseContent,
  };
  const sourceUseAssessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
    sourceUseAssessment,
    candidateAt
  );
  const reviewDecision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    decision: input.decision,
    reviewerId: 'local-hpn-field-map-reviewer',
    rationale: input.rationale,
    decidedAt,
  });
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(reviewDecision, decidedAt);
  return {
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    reviewDecision,
    decisionArtifact,
    projectedFieldMap:
      input.decision === 'approved'
        ? createAflTradeHpnProjectedFieldMap({
            candidate,
            candidateArtifact,
            decision: reviewDecision,
            decisionArtifact,
          })
        : null,
  };
}

describe('candidate-first HPN projected field-map PostgreSQL authority', () => {
  let database: PGlite | null = null;

  afterEach(async () => {
    await database?.close();
    database = null;
  });

  it('atomically registers and exact-replays an approved current projection', async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await expect(prepareDatabase(database)).resolves.toBeUndefined();
    const authority = new PostgresAflTradeHpnProjectedFieldMapAuthority(
      new PgliteSqlClient(database)
    );
    const projection = approvedProjection({
      decision: 'approved',
      rationale: 'Approve the exact private projection.',
    });

    await expect(authority.registerApprovedProjection(projection)).resolves.toEqual(
      projection.projectedFieldMap
    );
    await expect(authority.registerApprovedProjection(projection)).resolves.toEqual(
      projection.projectedFieldMap
    );
    await expect(
      authority.loadCurrentExact(projection.projectedFieldMap!.fieldMapId)
    ).resolves.toEqual(projection.projectedFieldMap);

    const counts = await database.query<{
      candidates: number;
      decisions: number;
      maps: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM outcome_hpn_field_map_candidate) AS candidates,
      (SELECT count(*)::integer FROM outcome_hpn_field_map_review_decision) AS decisions,
      (SELECT count(*)::integer FROM outcome_hpn_projected_field_map) AS maps`);
    expect(counts.rows[0]).toEqual({ candidates: 1, decisions: 1, maps: 1 });
  });

  it('fails closed after a later decision rejects the exact candidate', async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await prepareDatabase(database);
    const authority = new PostgresAflTradeHpnProjectedFieldMapAuthority(
      new PgliteSqlClient(database)
    );
    const projection = approvedProjection({
      decision: 'approved',
      rationale: 'Initial exact private approval.',
    });
    await authority.registerApprovedProjection(projection);
    const rejection = approvedProjection({
      decision: 'rejected',
      rationale: 'Withdraw the exact candidate from current use.',
    });
    await authority.registerDecision(rejection);

    await expect(
      authority.loadCurrentExact(projection.projectedFieldMap!.fieldMapId)
    ).resolves.toBeNull();
  });

  it('rejects mutation of every registered document', async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await prepareDatabase(database);
    const authority = new PostgresAflTradeHpnProjectedFieldMapAuthority(
      new PgliteSqlClient(database)
    );
    await authority.registerApprovedProjection(
      approvedProjection({ decision: 'approved', rationale: 'Immutable approval.' })
    );

    await expect(
      database.exec(`UPDATE outcome_hpn_projected_field_map SET provider='other'`)
    ).rejects.toThrow(/append-only/i);
    await expect(
      database.exec(`DELETE FROM outcome_hpn_field_map_review_decision`)
    ).rejects.toThrow(/append-only/i);
  });
});
