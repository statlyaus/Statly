import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  recordAflTradeEvidenceLocations,
  storeAndReadBackAflTradeEvidence,
  type AflTradeEvidenceStoreBinding,
} from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0253_gate_evidence_located';
const schemaName = `gate_evidence_located_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
const PROPOSED_AT = '2026-10-05T00:00:00.000Z';
const DECIDED_AT = '2026-10-05T01:00:00.000Z';
const REVALIDATE_AT = '2027-10-05T00:00:00.000Z';
let migration: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;
let store: AflTradeEvidenceStoreBinding;

type Environment = 'test_fixture' | 'non_production';

interface CitedEvidence {
  proposal?: string[];
  verification?: string[];
  authority?: string[];
  condition?: string[];
  reviewer?: string;
}

function unlocatedId(label: string): string {
  return createAflTradeContentAddress('artifact', { unlocated: label });
}

/** One Gate 1 proposal and its approval, citing exactly the given evidence. */
function gateRecords(decisionKey: string, environment: Environment, cited: CitedEvidence) {
  const scope = {
    scopeKey: decisionKey,
    description: 'Gate evidence custody fixture.',
    dimensions: [],
    exclusions: [],
  };
  const affectedArtifacts = [
    {
      kind: 'architecture_decision_package' as const,
      artifactId: createAflTradeContentAddress('architecture-decision-package', { decisionKey }),
    },
  ];
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_1_architecture_authority' as const,
    decisionKey,
    version: 1,
    environment,
    scope,
    proposal: 'Approve this architecture package.',
    alternativesConsidered: ['Keep the current architecture.'],
    accountableOwner: 'gate-evidence-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [
      {
        conditionId: 'evidence-retained',
        description: 'The cited evidence is retained.',
        required: true,
        verificationEvidenceIds: cited.verification ?? [],
      },
    ],
    evidenceIds: cited.proposal ?? [],
    affectedArtifacts,
    proposedAt: PROPOSED_AT,
    proposedBy: 'gate-evidence-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey,
    version: 1,
    environment,
    scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'gate-evidence-owner',
    decidedBy: 'gate-evidence-owner',
    reviewers:
      cited.reviewer === undefined
        ? []
        : [{ reviewerId: 'gate-reviewer', role: 'architect', evidenceId: cited.reviewer }],
    // A finalized decision needs authority; by default a database record, which custody never names.
    authorityEvidenceIds: cited.authority ?? [
      createAflTradeContentAddress('external-evidence', { decisionKey }),
    ],
    conditionResults: [
      {
        conditionId: 'evidence-retained',
        status: 'satisfied' as const,
        evidenceIds: cited.condition ?? [],
        explanation: 'The cited evidence was checked.',
      },
    ],
    rationale: 'The architecture package was reviewed.',
    limitations: ['Fixture authority only.'],
    decidedAt: DECIDED_AT,
    effectiveAt: DECIDED_AT,
    revalidateAt: REVALIDATE_AT,
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

/** Inserts the records the way a script bypassing the repository would. */
async function insertDirectly(records: ReturnType<typeof gateRecords>, decisionToo = true) {
  const { proposal, decision } = records;
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_gate_proposal (
         proposal_id, gate, decision_key, version, environment, scope_key, proposed_at, proposal_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        proposal.proposalId,
        proposal.content.gate,
        proposal.content.decisionKey,
        proposal.content.version,
        proposal.content.environment,
        proposal.content.scope.scopeKey,
        proposal.content.proposedAt,
        proposal,
      ]
    );
    if (!decisionToo) return;
    await transaction.query(
      `INSERT INTO outcome_gate_decision (
         decision_id, proposal_id, gate, decision_key, version, environment, state,
         decided_at, effective_at, revalidate_at, supersedes_decision_id, decision_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        decision.decisionId,
        decision.content.proposalId,
        decision.content.gate,
        decision.content.decisionKey,
        decision.content.version,
        decision.content.environment,
        decision.content.state,
        decision.content.decidedAt,
        decision.content.effectiveAt,
        decision.content.revalidateAt,
        decision.content.supersedesDecisionId,
        decision,
      ]
    );
    await transaction.query(
      `UPDATE outcome_gate_ledger_head SET revision=revision+1, updated_at=$1 WHERE singleton_id=1`,
      [DECIDED_AT]
    );
  });
}

async function revision(): Promise<number> {
  return (await ledger.load()).revision;
}

async function append(records: ReturnType<typeof gateRecords>) {
  return ledger.appendDecision({ expectedRevision: await revision(), ...records });
}

function textEvidence(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { reference: createAflTradeByteArtifactRef(bytes, 'text/plain', PROPOSED_AT), bytes };
}

async function insertCustody(reference: AflTradeArtifactRef): Promise<void> {
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,$7::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      `artifact://sha256/${reference.contentSha256}`,
      reference.mediaType,
      reference.byteLength,
      PROPOSED_AT,
      JSON.stringify({
        content: {
          repositoryAssurance: 'local_non_production_filesystem',
          custodyEnvironment: 'non_production',
          custodyProfileId: null,
          custodyProfile: null,
        },
      }),
    ]
  );
}

/** Writes bytes to the registered store, then records custody and location: the write-first path. */
async function retainEvidence(label: string): Promise<string> {
  const evidence = textEvidence(`gate evidence ${label}`);
  await storeAndReadBackAflTradeEvidence(store, [evidence]);
  await insertCustody(evidence.reference);
  await client.transaction((transaction) =>
    recordAflTradeEvidenceLocations(transaction, store, [evidence.reference])
  );
  return evidence.reference.artifactId;
}

/** A custody row whose bytes were never located, like the 1,590 recorded as lost. */
async function insertUnlocatedCustody(label: string): Promise<string> {
  const { reference } = textEvidence(`lost evidence ${label}`);
  await insertCustody(reference);
  return reference.artifactId;
}

const legacy = gateRecords('legacy-unlocated', 'non_production', {
  proposal: [unlocatedId('legacy-proposal')],
  authority: [unlocatedId('legacy-approval')],
  condition: [unlocatedId('legacy-approval')],
});

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  migration = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  // Before the migration the ledger takes evidence it never kept, as on 2026-09-29.
  await insertDirectly(legacy);
  await pool.query(migration.migrationSql);
  store = await bindTestEvidenceStore(pool);
}, 300_000);

afterAll(async () => {
  await migration?.cleanup();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

it('leaves an earlier decision that cites unretained evidence unchanged and loadable', async () => {
  const stored = await ledger.load();
  expect(stored.ledger.decisions.map(({ decisionId }) => decisionId)).toContain(
    legacy.decision.decisionId
  );
  // Its exact replay is still idempotent; nothing new is inserted.
  await expect(append(legacy)).resolves.toMatchObject({ idempotentReplay: true });
});

it('refuses evidence with no custody row, writing nothing', async () => {
  const before = await revision();
  const missing = unlocatedId('chat-approval');
  await expect(
    append(gateRecords('no-custody', 'non_production', { authority: [missing] }))
  ).rejects.toMatchObject({ code: 'ARTIFACT_UNLOCATED', artifactIds: [missing] });
  expect(await revision()).toBe(before);
});

it('refuses evidence whose custody row has no location, in every cited position', async () => {
  const lost = await insertUnlocatedCustody('lost');
  const positions: CitedEvidence[] = [
    { proposal: [lost] },
    { verification: [lost] },
    { authority: [lost] },
    { condition: [lost] },
  ];
  for (const [index, cited] of positions.entries()) {
    await expect(
      append(gateRecords(`lost-${index}`, 'non_production', cited))
    ).rejects.toMatchObject({ code: 'ARTIFACT_UNLOCATED', artifactIds: [lost] });
  }
});

it('accepts evidence written to the registered store first', async () => {
  const approval = await retainEvidence('approval');
  const review = await retainEvidence('review');
  const result = await append(
    gateRecords('retained', 'non_production', {
      proposal: [approval],
      verification: [review],
      authority: [approval],
      // Other prefixes address database records, not custody bytes.
      condition: [review, createAflTradeContentAddress('external-evidence', { row: 1 })],
    })
  );
  expect(result.idempotentReplay).toBe(false);
});

it('exempts test_fixture records', async () => {
  await expect(
    append(gateRecords('fixture', 'test_fixture', { authority: [unlocatedId('fixture')] }))
  ).resolves.toMatchObject({ idempotentReplay: false });
});

it('refuses a direct insert that bypasses the repository', async () => {
  const retained = await retainEvidence('direct');
  const missing = unlocatedId('direct-missing');
  await expect(
    insertDirectly(gateRecords('direct-proposal', 'non_production', { verification: [missing] }))
  ).rejects.toThrow(`Gate proposal cites evidence with no custody location: ${missing}`);
  await expect(
    insertDirectly(
      gateRecords('direct-reviewer', 'non_production', {
        proposal: [retained],
        authority: [retained],
        reviewer: missing,
      })
    )
  ).rejects.toThrow(`Gate decision cites evidence with no custody location: ${missing}`);
  // The same records citing only retained evidence insert.
  await expect(
    insertDirectly(
      gateRecords('direct-retained', 'non_production', {
        proposal: [retained],
        authority: [retained],
        reviewer: retained,
      })
    )
  ).resolves.toBeUndefined();
});
