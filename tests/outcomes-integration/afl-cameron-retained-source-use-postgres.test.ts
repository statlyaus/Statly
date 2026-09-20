import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createRetainedFitzRoyDerivedUseSuccessor } from '@/server/aflTradeIntelligence/source/retainedFitzRoyDerivedUseSuccessor';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
afterAll(async () => admin.end());

const sha = (character: string) => character.repeat(64);
const effectiveAt = '2026-09-20T00:00:00.000Z';
const ownerApprovalBytes = Buffer.from(
  JSON.stringify({
    decision: 'approved',
    approvedBy: 'statly-product-owner',
    approvedAt: '2026-09-19T00:00:00.000Z',
    ownerAuthorization: {
      approvedUses: [
        'valuation and grading',
        'retained source evidence as a basis for other documented methods',
      ],
    },
  })
);

/**
 * The activation set is seeded, so this case can prove the accept path with synthetic provenance
 * instead of the protected artifacts the production seeds name.
 */
function successorFixture() {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    profile: 'completed_match_result',
    provider: 'afl_tables',
    seasonYear: 2020,
  });
  const captured = fixture.command.capture;
  const rightsContent = structuredClone(captured.sourceRights.content);
  rightsContent.operations.derived_feature_creation = 'blocked';
  rightsContent.operations.model_training = 'blocked';
  rightsContent.operations.public_derived_output = 'blocked';
  rightsContent.operations.public_fact_display = 'blocked';
  rightsContent.fields = rightsContent.fields.map((field) => ({
    ...field,
    uses: {
      ...field.uses,
      derived_feature: 'blocked' as const,
      model_training: 'blocked' as const,
      public_display: 'blocked' as const,
    },
  }));
  // A fitzRoy rights manifest admits exactly one acquisition capability in the rights table.
  const acquisition = rightsContent.acquisition as {
    capabilities: { capabilityId: string }[];
  };
  const capabilityId = acquisition.capabilities[0]!.capabilityId;
  acquisition.capabilities = [acquisition.capabilities[0]!];
  const sourceRights = {
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  };
  const proposalContent = structuredClone(captured.ledger.proposals[0]!.content);
  proposalContent.accountableOwner = 'statly-product-owner';
  proposalContent.scope.dimensions = proposalContent.scope.dimensions.map((dimension) => {
    if (dimension.name === 'source_rights_artifact')
      return { ...dimension, values: [sourceRights.rightsArtifactId] };
    if (dimension.name === 'operation')
      return {
        ...dimension,
        values: dimension.values.filter(
          (value) => sourceRights.content.operations[value as never] === 'allowed'
        ),
      };
    if (dimension.name === 'commercial_context')
      return { ...dimension, values: ['internal-evaluation'] };
    if (dimension.name === 'audience') return { ...dimension, values: ['internal'] };
    return dimension;
  });
  proposalContent.affectedArtifacts = [
    { kind: 'source_rights', artifactId: sourceRights.rightsArtifactId },
  ];
  const proposal = {
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  };
  const decisionContent = {
    ...structuredClone(captured.ledger.decisions[0]!.content),
    proposalId: proposal.proposalId,
    scope: proposal.content.scope,
    accountableOwner: 'statly-product-owner',
    affectedArtifacts: proposal.content.affectedArtifacts,
  };
  const decision = {
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  };
  const captureId = `source-capture:${sha('a')}`;
  const sourceFields = ['away_points', 'home_points'];
  const candidateContent = {
    schemaVersion: 'statly-cameron-2020-hpn-retained-source-use-method/v1',
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2020,
    valuationScopeKey: 'cameron-2020-private-pilot',
    operation: 'derived_feature_creation',
    hpnPavMethodId: `hpn-pav-method:${sha('c')}`,
    ownerApprovalSha256: createHash('sha256').update(ownerApprovalBytes).digest('hex'),
    captureUses: [captureId, `source-capture:${sha('b')}`].map((id) => ({
      capabilityId,
      captureId: id,
      originalGateDecisionId: decision.decisionId,
      originalRightsArtifactId: sourceRights.rightsArtifactId,
      sourceFields,
    })),
    restrictions: {
      originalAcquisitionProvenanceImmutable: true,
      rawFieldRedistributionPermitted: false,
      publicOutputAuthorizedByThisCandidate: false,
      externalLicenseAsserted: false,
    },
    state: 'candidate_requires_durable_source_use_admission',
  };
  const methodUseCandidate = {
    methodUseId: createAflTradeContentAddress('cameron-2020-hpn-method-use', candidateContent),
    content: candidateContent,
  };
  const successor = createRetainedFitzRoyDerivedUseSuccessor({
    sourceRights,
    proposal,
    decision,
    methodUseCandidate,
    ownerApprovalBytes,
    captureId,
    effectiveAt,
    accountableOwner: 'statly-product-owner',
    reviewer: {
      id: 'source-reviewer',
      role: 'source-control-review',
      evidenceId: `artifact:${sha('d')}`,
    },
  });
  return {
    captureId,
    capabilityId,
    sourceFields,
    sourceRights,
    proposal,
    decision,
    successor,
    methodUseCandidate,
  };
}

it('permits the seeded capture and exact field set, and fails closed on every other shape', async () => {
  const schema = `afl_cameron_retained_${process.pid}`;
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schema);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
    max: 3,
  });
  const client = createPgAflOutcomeSqlClient(pool);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
    const fixture = successorFixture();
    const { captureId, capabilityId, sourceFields, sourceRights, proposal, decision, successor } =
      fixture;

    await client.query(
      `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2020)`
    );
    await client.query(
      `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,
         byte_length,artifact_class,environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'text/csv',1,'raw_source','non_production','synthetic-retained-custody',
         now(),now(),'{}')`,
      [`artifact:${sha('1')}`, sha('2'), `artifact://sha256/${sha('2')}`]
    );
    await client.query(
      `INSERT INTO outcome_source_capture_attempt (attempt_id,environment,provider,dataset,
         capability_id,status,started_at,completed_at,attempt_json)
       VALUES ('capture-attempt:retained','non_production',$1,$2,$3,'captured',clock_timestamp(),
         clock_timestamp(),'{}')`,
      [sourceRights.content.provider, sourceRights.content.dataset, capabilityId]
    );
    await client.query(
      `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,
         source_artifact_id,environment,provider,dataset,dataset_version,access_mechanism,
         capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
       VALUES ($1,'capture-attempt:retained','source-snapshot:retained',$2,'non_production',$3,$4,$5,
         'synthetic',$6,'AFLM',2020,clock_timestamp(),clock_timestamp(),'staged',
         jsonb_build_object('sourceRightsProposal',$7::jsonb,'gate0aDecision',$8::jsonb,
           'gate0aProposal',$9::jsonb))`,
      [
        captureId,
        `artifact:${sha('1')}`,
        sourceRights.content.provider,
        sourceRights.content.dataset,
        sourceRights.content.datasetVersion,
        capabilityId,
        JSON.stringify(sourceRights),
        JSON.stringify(decision),
        JSON.stringify(proposal),
      ]
    );
    await insertRights(client, capabilityId, sourceRights);
    await insertRights(client, capabilityId, successor.sourceRights);
    const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [{ sourceRights, proposal, decision }],
    });
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [
        {
          sourceRights: successor.sourceRights,
          proposal: successor.proposal,
          decision: successor.decision,
        },
      ],
    });
    await client.query(
      `INSERT INTO outcome_hpn_retained_source_successor_capture (capture_id,capability_id,
         origin_gate_decision_id,origin_rights_artifact_id,expected_fields,method_use_id,
         hpn_pav_method_id,owner_approval_sha256)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        captureId,
        capabilityId,
        decision.decisionId,
        sourceRights.rightsArtifactId,
        JSON.stringify(sourceFields),
        fixture.methodUseCandidate.methodUseId,
        fixture.methodUseCandidate.content.hpnPavMethodId,
        fixture.methodUseCandidate.content.ownerApprovalSha256,
      ]
    );

    const permits = async (fields: readonly string[], at = 'clock_timestamp()') =>
      client.transaction(async (transaction) => {
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        const result = await transaction.query<{ permitted: boolean }>(
          `SELECT outcome_hpn_cameron_2020_retained_use_is_current($1,$2::jsonb,${at}) AS permitted`,
          [captureId, JSON.stringify(fields)]
        );
        return result.rows[0]!.permitted;
      });

    expect(await permits(sourceFields)).toBe(true);
    expect(await permits(['away_points'])).toBe(false);
    expect(await permits([...sourceFields, 'home_goals'])).toBe(false);
    expect(
      await permits(sourceFields, `'${successor.decision.content.revalidateAt}'::timestamptz`)
    ).toBe(false);
    expect(
      await client
        .query(
          `SELECT outcome_hpn_cameron_2020_retained_use_is_current($1,$2::jsonb,clock_timestamp())
             AS permitted`,
          [`source-capture:${sha('f')}`, JSON.stringify(sourceFields)]
        )
        .then((result) => result.rows[0]!.permitted)
    ).toBe(false);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});

function insertRights(
  client: ReturnType<typeof createPgAflOutcomeSqlClient>,
  capabilityId: string,
  rights: { rightsArtifactId: string; content: Record<string, any> }
) {
  return client.query(
    `INSERT INTO outcome_source_rights_proposal (rights_artifact_id,provider,dataset,
       dataset_version,capability_id,proposed_at,content_json)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb)`,
    [
      rights.rightsArtifactId,
      rights.content.provider,
      rights.content.dataset,
      rights.content.datasetVersion,
      capabilityId,
      rights.content.proposedAt,
      JSON.stringify(rights),
    ]
  );
}
