import { verifySessionAcquisitionCurrentness } from '../testUtils/sessionAcquisitionCurrentness';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
  createAflTradeExternalIdentityReviewPackage,
  createAflTradeExternalIdentityReviewWorkItem,
  createAflTradeExternalIdentitySubject,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `combined_draft_sessions_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const hex = (value: string) => value.repeat(64);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN; END IF; END $$`
  );
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schema}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT ON "${schema}".outcome_review_decision,
                     "${schema}".outcome_governed_evidence_reference
       TO afl_trade_nonproduction_governance_registry_writer`
  );
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('reconstructs combined sessions, rejects downgrades, and fails after dependency revocation', async () => {
  const candidateId = `external-reconciliation:${hex('a')}`;
  const selectionIds = [
    `external-draft-selection:${hex('1')}`,
    `external-draft-selection:${hex('2')}`,
    `external-draft-selection:${hex('3')}`,
    `external-draft-selection:${hex('4')}`,
  ];
  const facts = [
    {
      key: 'date-1',
      capture: 1,
      claim: {
        kind: 'draft_session_date',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2024-11-20',
      },
    },
    {
      key: 'complete-1',
      capture: 1,
      claim: {
        kind: 'draft_session_completion',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 1,
      },
    },
    {
      key: 'first-1',
      capture: 1,
      claim: {
        kind: 'draft_session_boundary',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Player One' },
        selectedByClub: { nativeId: null, recordedName: 'Club One' },
      },
    },
    {
      key: 'date-2',
      capture: 2,
      claim: {
        kind: 'draft_session_date',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2024-11-21',
      },
    },
    {
      key: 'complete-2',
      capture: 2,
      claim: {
        kind: 'draft_session_completion',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 2,
      },
    },
    {
      key: 'first-2',
      capture: 2,
      claim: {
        kind: 'draft_session_boundary',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'first',
        selectionNumber: 3,
        player: { nativeId: null, recordedName: 'Player Three' },
        selectedByClub: { nativeId: null, recordedName: 'Club Three' },
      },
    },
    {
      key: 'last-2',
      capture: 2,
      claim: {
        kind: 'draft_session_boundary',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'last',
        selectionNumber: 4,
        player: { nativeId: null, recordedName: 'Player Four' },
        selectedByClub: { nativeId: null, recordedName: 'Club Four' },
      },
    },
    {
      key: 'total',
      capture: 3,
      claim: {
        kind: 'draft_completed_total',
        draftYear: 2024,
        draftType: 'national',
        selectionCount: 4,
      },
    },
  ] as const;
  const evidenceIds = facts
    .map((_, index) => `external-evidence:${String(index + 1).repeat(64)}`)
    .sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query(
      `INSERT INTO outcome_external_reconciliation_candidate
       (candidate_id,environment,competition,anchor_season_year,reconciled_at,source_batch_count,
        identity_resolution_count,transaction_count,transfer_count,draft_selection_count,
        pick_custody_count,pick_lineage_count,issue_count,status,finalized_at,candidate_json)
       VALUES($1,'test_fixture','AFLM',2024,'2024-11-22',3,6,0,0,4,0,0,0,'finalized',
              '2024-11-22',$2::jsonb)`,
      [
        candidateId,
        JSON.stringify({
          content: {
            environment: 'test_fixture',
            competition: 'AFLM',
            anchorSeasonYear: 2024,
            publicationEligible: false,
          },
        }),
      ]
    );
    for (let capture = 1; capture <= 3; capture += 1) {
      const captureId = `source-capture:${String(capture).repeat(64)}`;
      const batchId = `external-evidence-batch:${String(capture).repeat(64)}`;
      await client.query(
        `INSERT INTO outcome_source_capture
         (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
          dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
          captured_at,status,manifest_json)
         VALUES($1,$2,$3,$4,'test_fixture','official_afl','draft-session','fixture-v1',
                'automated_web','official-afl-completed-draft-session','AFLM',2024,
                '2024-11-22','2024-11-22','approved',$5::jsonb)`,
        [
          captureId,
          `attempt-${capture}`,
          `snapshot-${capture}`,
          `artifact:${String(capture).repeat(64)}`,
          JSON.stringify({
            sourceUrl: `https://www.afl.com.au/news/${900000 + capture}/article-${capture}`,
          }),
        ]
      );
      const rows = facts.filter((fact) => fact.capture === capture);
      await client.query(
        `INSERT INTO outcome_external_evidence_batch
         (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
          status,finalized_at,batch_json)
         VALUES($1,$2,'official_afl',$3,0,$4,$5,'finalized','2024-11-22','{}')`,
        [batchId, captureId, rows.length, hex(String(capture)), hex('f')]
      );
      await client.query(
        `INSERT INTO outcome_external_reconciliation_source_batch(candidate_id,ordinal,batch_id)
         VALUES($1,$2,$3)`,
        [candidateId, capture, batchId]
      );
      for (const [ordinal, fact] of rows.entries()) {
        const sourceIndex = facts.indexOf(fact);
        await client.query(
          `INSERT INTO outcome_external_evidence_row
           (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            evidenceIds[sourceIndex],
            batchId,
            ordinal + 1,
            fact.key,
            fact.claim.kind,
            JSON.stringify({ content: { provider: 'official_afl', claim: fact.claim } }),
          ]
        );
      }
    }
    for (const [index, selectionId] of selectionIds.entries()) {
      await client.query(
        `INSERT INTO outcome_external_reconciliation_draft_selection
         (candidate_id,ordinal,selection_id,draft_year,draft_type,selection_number,pick_id,status,selection_json)
         VALUES($1,$2,$3,2024,'national',$2,$4,'single_source',$5::jsonb)`,
        [
          candidateId,
          index + 1,
          selectionId,
          `draft-pick:${String(index + 4).repeat(64)}`,
          JSON.stringify({
            pickId: `draft-pick:${String(index + 4).repeat(64)}`,
            playerId: `player-${index + 1}`,
            clubId: `club-${index + 1}`,
            evidenceIds,
          }),
        ]
      );
    }
    const identities = [
      ['player', 'Player One', 'player-1'],
      ['club', 'Club One', 'club-1'],
      ['player', 'Player Three', 'player-3'],
      ['club', 'Club Three', 'club-3'],
      ['player', 'Player Four', 'player-4'],
      ['club', 'Club Four', 'club-4'],
    ] as const;
    for (const [index, [kind, recordedName, canonicalId]] of identities.entries()) {
      const identityDigest = ['5', '6', '7', '8', '9', 'b'][index]!;
      const decisionId = `review-decision:${hex(identityDigest)}`;
      await client.query(
        `INSERT INTO outcome_review_decision
         (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES($1,'external_identity','fixture','approved','fixture','{}','fixture','2024-11-22')`,
        [decisionId]
      );
      await client.query(
        `INSERT INTO outcome_external_reconciliation_identity_resolution
         (candidate_id,ordinal,resolution_id,review_decision_id,provider,entity_kind,canonical_id,resolution_json)
         VALUES($1,$2,$3,$4,'official_afl',$5,$6,$7::jsonb)`,
        [
          candidateId,
          index + 1,
          `external-identity-resolution:${hex(identityDigest)}`,
          decisionId,
          kind,
          canonicalId,
          JSON.stringify({
            content: {
              reviewDecisionId: decisionId,
              provider: 'official_afl',
              entityKind: kind,
              canonicalId,
              sourceIdentity: { nativeId: null, recordedName },
            },
          }),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const proposal = {
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
    proposedAt: '2024-11-22T12:00:00.000Z',
    draftEventCoverage: [selectionIds.slice(0, 2), selectionIds.slice(2)].map((members, index) => ({
      draftYear: 2024,
      draftType: 'national',
      sessionOrdinal: index + 1,
      eventDate: `2024-11-${20 + index}`,
      officialName: '2024 AFL Draft',
      expectedSelectionCount: 2,
      selectionIds: members,
      evidenceIds,
      status: 'complete',
      proofKind: 'combined_session_facts',
    })),
  };
  const exact = async (value: unknown) =>
    (
      await pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [candidateId, JSON.stringify(value)]
      )
    ).rows[0]!.valid;

  const withExtraFact = async (
    digest: string,
    claim: Record<string, unknown>,
    check: (extraEvidenceId: string) => Promise<void>
  ) => {
    const extraEvidenceId = `external-evidence:${hex(digest)}`;
    const revision = await pool.connect();
    try {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query(
        `INSERT INTO outcome_external_evidence_row
         (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
         VALUES($1,$2,99,$3,$4,$5::jsonb)`,
        [
          extraEvidenceId,
          `external-evidence-batch:${hex('1')}`,
          `extra-${digest}`,
          claim.kind,
          JSON.stringify({ content: { provider: 'official_afl', claim } }),
        ]
      );
      await revision.query('COMMIT');
      await check(extraEvidenceId);
    } finally {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query('DELETE FROM outcome_external_evidence_row WHERE evidence_id=$1', [
        extraEvidenceId,
      ]);
      await revision.query('COMMIT');
      revision.release();
    }
  };

  const proposalIncluding = (extraEvidenceId: string) => ({
    ...proposal,
    draftEventCoverage: proposal.draftEventCoverage.map((coverage) => ({
      ...coverage,
      evidenceIds: [...coverage.evidenceIds, extraEvidenceId].sort(),
    })),
  });

  expect(await exact(proposal)).toBe(true);
  const v5 = { ...proposal, schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v5' };
  expect(await exact(v5)).toBe(true);
  const enumeratedClient = await pool.connect();
  try {
    await enumeratedClient.query('BEGIN');
    await enumeratedClient.query('SET LOCAL session_replication_role=replica');
    await enumeratedClient.query(
      `UPDATE outcome_external_reconciliation_draft_selection
       SET selection_number=CASE selection_number WHEN 3 THEN 7 WHEN 4 THEN 97 ELSE selection_number END
       WHERE candidate_id=$1`,
      [candidateId]
    );
    await enumeratedClient.query(
      `UPDATE outcome_external_evidence_row SET evidence_json=jsonb_set(evidence_json,
        '{content,claim,selectionNumber}',to_jsonb(CASE (evidence_json#>>'{content,claim,selectionNumber}')::INTEGER
          WHEN 3 THEN 7 WHEN 4 THEN 97 ELSE (evidence_json#>>'{content,claim,selectionNumber}')::INTEGER END))
       WHERE claim_kind='draft_session_boundary' AND evidence_json#>>'{content,claim,draftYear}'='2024'`
    );
    const checkEnumerated = async (value: unknown) =>
      (
        await enumeratedClient.query(
          "SELECT outcome_external_combined_draft_group_exact($1,$2::jsonb,2024,'national') AS valid",
          [candidateId, JSON.stringify(value)]
        )
      ).rows[0].valid;
    expect(await checkEnumerated(proposal)).toBe(false);
    const memberId = `external-evidence:${hex('e')}`;
    await enumeratedClient.query(
      `INSERT INTO outcome_external_evidence_row
       (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       VALUES($1,$2,99,'complete-membership','draft_completed_inventory',$3::jsonb)`,
      [
        memberId,
        `external-evidence-batch:${hex('1')}`,
        JSON.stringify({
          content: {
            provider: 'official_afl',
            claim: {
              kind: 'draft_completed_inventory',
              draftYear: 2024,
              draftType: 'national',
              selectionNumbers: [1, 2, 7, 97],
            },
          },
        }),
      ]
    );
    const enumeratedProposal = proposalIncluding(memberId);
    expect(await checkEnumerated(enumeratedProposal)).toBe(false);
    await enumeratedClient.query(
      `UPDATE outcome_external_reconciliation_draft_selection SET selection_json=jsonb_set(
        selection_json,'{evidenceIds}',(selection_json->'evidenceIds') || to_jsonb($2::text))
       WHERE candidate_id=$1`,
      [candidateId, memberId]
    );
    expect(await checkEnumerated(enumeratedProposal)).toBe(true);
    for (const numbers of [
      [1, 2, 7],
      [1, 2, 7, 97, 98],
      [1, 2, 7, 7],
      [1, 2, 3, 97],
      [97, 7, 2, 1],
    ]) {
      await enumeratedClient.query(
        `UPDATE outcome_external_evidence_row SET evidence_json=jsonb_set(evidence_json,
          '{content,claim,selectionNumbers}',$2::jsonb) WHERE evidence_id=$1`,
        [memberId, JSON.stringify(numbers)]
      );
      expect(await checkEnumerated(enumeratedProposal)).toBe(false);
    }
    const rosterClaim = {
      kind: 'draft_completed_membership_roster',
      draftYear: 2024,
      draftType: 'national',
      members: [
        { recordedName: 'One', selectionNumber: 1 },
        { recordedName: 'Two', selectionNumber: 2 },
        { recordedName: 'Academy', selectionNumber: null },
        { recordedName: 'Last', selectionNumber: 97 },
      ],
    };
    await enumeratedClient.query(
      `UPDATE outcome_external_evidence_row SET claim_kind='draft_completed_membership_roster',
      evidence_json=jsonb_set(evidence_json,'{content,claim}',$2::jsonb) WHERE evidence_id=$1`,
      [memberId, JSON.stringify(rosterClaim)]
    );
    expect(await checkEnumerated(enumeratedProposal)).toBe(false);
    const bindingId = `external-evidence:${hex('f')}`;
    const bindingClaim = {
      kind: 'draft_completed_member_number',
      draftYear: 2024,
      draftType: 'national',
      recordedName: 'Academy',
      selectionNumber: 7,
    };
    await enumeratedClient.query(
      `INSERT INTO outcome_external_evidence_row
      (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
      VALUES($1,$2,100,'member-number','draft_completed_member_number',$3::jsonb)`,
      [
        bindingId,
        `external-evidence-batch:${hex('2')}`,
        JSON.stringify({ content: { provider: 'official_afl', claim: bindingClaim } }),
      ]
    );
    const joinedProposal = {
      ...enumeratedProposal,
      draftEventCoverage: enumeratedProposal.draftEventCoverage.map((session) => ({
        ...session,
        evidenceIds: [...session.evidenceIds, bindingId].sort(),
      })),
    };
    expect(await checkEnumerated(joinedProposal)).toBe(false);
    await enumeratedClient.query(
      `UPDATE outcome_external_reconciliation_draft_selection SET selection_json=jsonb_set(
      selection_json,'{evidenceIds}',(selection_json->'evidenceIds') || to_jsonb($2::text)) WHERE candidate_id=$1`,
      [candidateId, bindingId]
    );
    expect(await checkEnumerated(joinedProposal)).toBe(true);
    for (const changed of [
      { ...bindingClaim, recordedName: 'Other' },
      { ...bindingClaim, selectionNumber: 2 },
      { ...bindingClaim, draftYear: 2023 },
      { ...bindingClaim, draftType: 'rookie' },
    ]) {
      await enumeratedClient.query(
        `UPDATE outcome_external_evidence_row SET evidence_json=jsonb_set(evidence_json,
        '{content,claim}',$2::jsonb) WHERE evidence_id=$1`,
        [bindingId, JSON.stringify(changed)]
      );
      expect(await checkEnumerated(joinedProposal)).toBe(false);
    }
  } finally {
    await enumeratedClient.query('ROLLBACK');
    enumeratedClient.release();
  }
  const mixedClient = await pool.connect();
  try {
    await mixedClient.query('BEGIN');
    await mixedClient.query('SET LOCAL session_replication_role=replica');
    const directId = `external-evidence:${hex('c')}`;
    const directSelection = `external-draft-selection:${hex('c')}`;
    const direct = {
      draftYear: 2025,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2025-11-20',
      officialName: '2025 AFL Draft',
      expectedSelectionCount: 1,
      selectionIds: [directSelection],
      evidenceIds: [directId],
      status: 'complete',
      proofKind: 'direct_session_claim',
    };
    await mixedClient.query(
      `INSERT INTO outcome_external_reconciliation_draft_selection
      (candidate_id,ordinal,selection_id,draft_year,draft_type,selection_number,pick_id,status,selection_json)
      VALUES($1,5,$2,2025,'national',1,$3,'single_source',$4::jsonb)`,
      [
        candidateId,
        directSelection,
        `draft-pick:${hex('c')}`,
        JSON.stringify({ playerId: 'player-1', clubId: 'club-1', evidenceIds: [directId] }),
      ]
    );
    await mixedClient.query(
      `INSERT INTO outcome_external_evidence_row
      (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
      VALUES($1,$2,99,'v5-direct','draft_session',$3::jsonb)`,
      [
        directId,
        `external-evidence-batch:${hex('1')}`,
        JSON.stringify({
          content: {
            provider: 'official_afl',
            claim: {
              kind: 'draft_session',
              draftYear: 2025,
              draftType: 'national',
              sessionOrdinal: 1,
              eventDate: direct.eventDate,
              officialName: direct.officialName,
              selectionNumbers: [1],
            },
          },
        }),
      ]
    );
    await mixedClient.query('SET LOCAL session_replication_role=origin');
    const mixed = {
      ...v5,
      proposedAt: '2025-11-22T12:00:00.000Z',
      draftEventCoverage: [...v5.draftEventCoverage, direct],
    };
    const verify = async (value: unknown) =>
      (
        await mixedClient.query<{ valid: boolean }>(
          'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
          [candidateId, JSON.stringify(value)]
        )
      ).rows[0]!.valid;
    expect(await verify(mixed)).toBe(true);
    expect(
      await verify({ ...mixed, draftEventCoverage: mixed.draftEventCoverage.slice(0, 2) })
    ).toBe(false);
    for (const changed of [
      { ...direct, selectionIds: [selectionIds[0]] },
      { ...direct, evidenceIds: [evidenceIds[0]] },
      { ...direct, proofKind: 'combined_session_facts' },
      { ...direct, sessionOrdinal: 2 },
      { ...direct, eventDate: '2025-11-21' },
    ])
      expect(
        await verify({ ...mixed, draftEventCoverage: [...v5.draftEventCoverage, changed] })
      ).toBe(false);
    expect(
      await verify({
        ...mixed,
        draftEventCoverage: [
          { ...v5.draftEventCoverage[0], proofKind: 'direct_session_claim' },
          v5.draftEventCoverage[1],
          direct,
        ],
      })
    ).toBe(false);
  } finally {
    await mixedClient.query('ROLLBACK');
    mixedClient.release();
  }

  const identityGuard = await pool.query<{ definition: string }>(
    `SELECT pg_get_functiondef('validate_outcome_external_identity_review_insert()'::regprocedure)
       AS definition`
  );
  expect(identityGuard.rows[0]?.definition).toContain(
    "ELSIF claim->>'kind' IN ('draft_session_boundary','draft_session_member_identity') THEN"
  );
  expect(identityGuard.rows[0]?.definition).toContain(
    "(subject.entity_kind='player' AND claim->'player'=source_identity) OR"
  );
  expect(identityGuard.rows[0]?.definition).toContain(
    "(subject.entity_kind='club' AND claim->'selectedByClub'=source_identity);"
  );
  expect(
    await exact({
      ...proposal,
      schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v2',
    })
  ).toBe(false);
  expect(
    await exact({
      ...proposal,
      draftEventCoverage: proposal.draftEventCoverage.map((coverage, index) =>
        index === 1 ? { ...coverage, eventDate: '2024-11-20' } : coverage
      ),
    })
  ).toBe(false);
  expect(
    await exact({
      ...proposal,
      draftEventCoverage: [
        {
          ...proposal.draftEventCoverage[0],
          expectedSelectionCount: 3,
          selectionIds: [selectionIds[0], selectionIds[1], selectionIds[3]],
        },
        {
          ...proposal.draftEventCoverage[1],
          expectedSelectionCount: 1,
          selectionIds: [selectionIds[2]],
        },
      ],
    })
  ).toBe(false);

  for (const [digest, claim] of [
    [
      'c',
      {
        kind: 'draft_session_date',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 3,
        eventDate: '2024-11-22',
      },
    ],
    [
      'd',
      {
        kind: 'draft_session_completion',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 3,
      },
    ],
    [
      'e',
      {
        kind: 'draft_session_boundary',
        draftYear: 2024,
        draftType: 'national',
        sessionOrdinal: 3,
        boundary: 'first',
        selectionNumber: 5,
        player: { nativeId: null, recordedName: 'Player Five' },
        selectedByClub: { nativeId: null, recordedName: 'Club Five' },
      },
    ],
  ] as const) {
    await withExtraFact(digest, claim, async (extraEvidenceId) => {
      expect(await exact(proposalIncluding(extraEvidenceId))).toBe(false);
    });
  }

  await withExtraFact(
    'f',
    {
      kind: 'draft_completed_total',
      draftYear: 2023,
      draftType: 'national',
      selectionCount: 4,
    },
    async (extraEvidenceId) => {
      expect(await exact(proposalIncluding(extraEvidenceId))).toBe(false);
    }
  );

  const setCaptureManifest = async (captureNumber: string, sourceUrl: string) => {
    const revision = await pool.connect();
    try {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query(
        `UPDATE outcome_source_capture SET manifest_json=$2::jsonb WHERE capture_id=$1`,
        [`source-capture:${hex(captureNumber)}`, JSON.stringify({ sourceUrl })]
      );
      await revision.query('COMMIT');
    } catch (error) {
      await revision.query('ROLLBACK');
      throw error;
    } finally {
      revision.release();
    }
  };
  await setCaptureManifest('3', 'https://www.afl.com.au/news/900002/alternate-terminal-alias');
  expect(await exact(proposal)).toBe(false);
  await setCaptureManifest('3', 'https://www.afl.com.au/news/900003/article-3');
  await setCaptureManifest('2', 'https://example.test/unrecognized-terminal');
  expect(await exact(proposal)).toBe(false);
  await setCaptureManifest('2', 'https://www.afl.com.au/news/900002/article-2');
  expect(await exact(proposal)).toBe(true);

  const setCaptureStatus = async (status: 'approved' | 'rejected') => {
    const revision = await pool.connect();
    try {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query(`UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1`, [
        `source-capture:${hex('3')}`,
        status,
      ]);
      await revision.query('COMMIT');
    } catch (error) {
      await revision.query('ROLLBACK');
      throw error;
    } finally {
      revision.release();
    }
  };
  await setCaptureStatus('rejected');
  expect(await exact(proposal)).toBe(false);
  await setCaptureStatus('approved');

  await pool.query(
    `INSERT INTO outcome_review_decision
     (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,'external_identity','fixture','withdrawn',$2,'revoked','{}','fixture','2024-11-23')`,
    [`review-decision:${hex('c')}`, `review-decision:${hex('5')}`]
  );
  expect(await exact(proposal)).toBe(false);
});

it('promotes combined proof and invalidates its public acquisition read when a source is revoked', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    combinedDraftSessions: true,
  });
  expect(promoted.proposal.content.schemaVersion).toBe(
    'afl-trade-external-canonical-promotion-proposal/v3'
  );
  expect(promoted.draftAssets.map(({ event_date }) => event_date)).toEqual([
    '2024-11-20',
    '2024-11-21',
  ]);

  await verifySessionAcquisitionCurrentness(pool, promoted);
});

it('runs the reviewed 2016 proof through public promotion and current spell guards', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    combinedDraftSessions: true,
    officialCombinedDraftYear: 2016,
    environment: 'non_production',
  });
  expect(promoted.candidate.content.environment).toBe('non_production');
  expect(promoted.candidate.content.anchorSeasonYear).toBe(2016);
  expect(promoted.candidate.content.issues).toEqual([]);
  expect(promoted.candidate.content.draftSelections).toHaveLength(77);
  expect(promoted.candidate.content.pickCustody).toEqual([]);
  expect(promoted.proposal.content.draftEventCoverage).toEqual([
    expect.objectContaining({
      draftYear: 2016,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2016-11-25',
      expectedSelectionCount: 77,
      proofKind: 'combined_session_facts',
      status: 'complete',
    }),
  ]);
  expect(promoted.draftAssets).toHaveLength(77);
  expect(new Set(promoted.draftAssets.map(({ event_date }) => event_date))).toEqual(
    new Set(['2016-11-25'])
  );
  const retrospectiveTiming = await pool.query<{ effective_at: Date }>(
    `SELECT capture.effective_at
       FROM outcome_external_reconciliation_source_batch source
       JOIN outcome_external_evidence_batch batch USING(batch_id)
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      WHERE source.candidate_id=$1
        AND capture.manifest_json->>'sourceUrl' LIKE 'https://www.afl.com.au/news/149290/%'`,
    [promoted.candidate.candidateId]
  );
  expect(retrospectiveTiming.rows.map(({ effective_at }) => effective_at.toISOString())).toEqual([
    '2019-11-28T11:30:00.000Z',
  ]);
  expect(
    (
      await pool.query<{ original_club_id: string | null }>(
        'SELECT DISTINCT original_club_id FROM outcome_draft_pick WHERE pick_id=ANY($1::text[])',
        [promoted.candidate.content.draftSelections.map(({ pickId }) => pickId)]
      )
    ).rows
  ).toEqual([{ original_club_id: null }]);

  const sql = createPgAflOutcomeSqlClient(pool);
  const promotions = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
  const replayPromotion = () =>
    promotions.promote({
      candidateId: promoted.candidate.candidateId,
      approvalDecisionId: promoted.approvalDecisionId,
    });
  const exactCurrentProof = async () =>
    (
      await pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [promoted.candidate.candidateId, JSON.stringify(promoted.proposal.content)]
      )
    ).rows[0]!.valid;
  expect(await exactCurrentProof()).toBe(true);
  await expect(replayPromotion()).resolves.toMatchObject({
    draftSelectionCount: 77,
    draftPlayerAssetCount: 77,
    idempotentReplay: true,
  });

  const at = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(sql, {
    read: async (reference) => {
      const retained = promoted.retainedArtifacts.get(reference.artifactId);
      if (!retained) throw new Error('Missing retained Official 2016 fixture bytes.');
      return retained.bytes;
    },
  });
  const approve = async (subjectType: string, subjectId: string, evidence: unknown) => {
    const decisionId = `official-2016-lifecycle-review:${subjectId}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES($1,$2,$3,'approved','Official 2016 lifecycle fixture',$4::jsonb,
              'fixture-reviewer',$5)`,
      [decisionId, subjectType, subjectId, JSON.stringify(evidence), await at()]
    );
    return decisionId;
  };
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'official-2016-combined-session-public-path-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await at(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const entry = promoted.draftEntries[0]!;
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: entry.player_id,
    clubId: promoted.clubId,
    entry: entry.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await at(),
  });
  const spellApprovalId = await approve(
    'acquisition_spell_registration',
    spell.spellVersionId,
    spell
  );
  await expect(spells.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(spell);
  await expect(spells.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(spell);
  await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).resolves.toEqual(spell);

  const requiredCaptures = (
    await pool.query<{ capture_id: string }>(
      `SELECT DISTINCT capture.capture_id
       FROM outcome_external_reconciliation_source_batch source
       JOIN outcome_external_evidence_row row USING(batch_id)
       JOIN outcome_external_evidence_batch batch USING(batch_id)
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       WHERE source.candidate_id=$1 AND row.claim_kind IN
         ('draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
       ORDER BY capture.capture_id`,
      [promoted.candidate.candidateId]
    )
  ).rows.map(({ capture_id }) => capture_id);
  const replicaUpdate = async (query: string, parameters: unknown[]) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query(query, parameters);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  expect(requiredCaptures).toHaveLength(3);
  for (const captureId of requiredCaptures) {
    await replicaUpdate('UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
      captureId,
      'rejected',
    ]);
    expect(await exactCurrentProof()).toBe(false);
    await expect(replayPromotion()).rejects.toThrow('exact current draft-session evidence');
    await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).rejects.toThrow();
    await replicaUpdate('UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
      captureId,
      'approved',
    ]);
    expect(await exactCurrentProof()).toBe(true);
    await expect(replayPromotion()).resolves.toMatchObject({ idempotentReplay: true });
    await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).resolves.toEqual(spell);
  }

  const boundaryIdentity = promoted.identityResolutions.find(
    ({ content }) =>
      content.provider === 'official_afl' &&
      content.entityKind === 'player' &&
      content.sourceIdentity.recordedName === 'Andrew McGrath'
  );
  if (!boundaryIdentity) throw new Error('Missing reviewed 2016 boundary identity.');
  await replicaUpdate('UPDATE outcome_review_decision SET decision=$2 WHERE decision_id=$1', [
    boundaryIdentity.content.reviewDecisionId,
    'rejected',
  ]);
  expect(await exactCurrentProof()).toBe(false);
  await expect(replayPromotion()).rejects.toThrow('exact current draft-session evidence');
  await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).rejects.toThrow();
  await replicaUpdate('UPDATE outcome_review_decision SET decision=$2 WHERE decision_id=$1', [
    boundaryIdentity.content.reviewDecisionId,
    'approved',
  ]);
  expect(await exactCurrentProof()).toBe(true);
  await expect(replayPromotion()).resolves.toMatchObject({ idempotentReplay: true });
  await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).resolves.toEqual(spell);
}, 120_000);

it('runs the reviewed 2017 proof through the non-production public promotion and spell lifecycle', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    combinedDraftSessions: true,
    official2017CombinedDraft: true,
    environment: 'non_production',
  });
  expect(promoted.candidate.content.environment).toBe('non_production');
  expect(promoted.candidate.content.anchorSeasonYear).toBe(2017);
  expect(promoted.candidate.content.issues).toEqual([]);
  expect(promoted.candidate.content.draftSelections).toHaveLength(78);
  expect(promoted.proposal.content.schemaVersion).toBe(
    'afl-trade-external-canonical-promotion-proposal/v3'
  );
  expect(new Set(promoted.draftAssets.map(({ event_date }) => event_date))).toEqual(
    new Set(['2017-11-24'])
  );

  const at = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    {
      read: async (reference) => {
        const retained = promoted.retainedArtifacts.get(reference.artifactId);
        if (!retained) throw new Error('Missing retained Official 2017 fixture bytes.');
        return retained.bytes;
      },
    }
  );
  const approve = async (subjectType: string, subjectId: string, evidence: unknown) => {
    const decisionId = `official-2017-lifecycle-review:${subjectId}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES($1,$2,$3,'approved','Official 2017 lifecycle fixture',$4::jsonb,
              'fixture-reviewer',$5)`,
      [decisionId, subjectType, subjectId, JSON.stringify(evidence), await at()]
    );
    return decisionId;
  };
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'official-2017-combined-session-public-path-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await at(),
  });
  await repository.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const entry = promoted.draftEntries[0]!;
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: entry.player_id,
    clubId: promoted.clubId,
    entry: entry.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await at(),
  });
  const spellApprovalId = await approve(
    'acquisition_spell_registration',
    spell.spellVersionId,
    spell
  );
  await expect(repository.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(
    spell
  );
  await expect(repository.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(
    spell
  );
  expect(
    (
      await pool.query<{ count: string }>(
        'SELECT count(*)::TEXT AS count FROM outcome_acquisition_spell_version WHERE spell_version_id=$1',
        [spell.spellVersionId]
      )
    ).rows[0]!.count
  ).toBe('1');
  expect((await repository.loadCurrentExact(spell.spellVersionId, scope)).spellVersionId).toBe(
    spell.spellVersionId
  );

  const requiredCaptures = (
    await pool.query<{ capture_id: string }>(
      `SELECT DISTINCT capture.capture_id
       FROM outcome_external_reconciliation_source_batch source
       JOIN outcome_external_evidence_row row USING(batch_id)
       JOIN outcome_external_evidence_batch batch USING(batch_id)
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       WHERE source.candidate_id=$1 AND row.claim_kind IN
         ('draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
       ORDER BY capture.capture_id`,
      [promoted.candidate.candidateId]
    )
  ).rows.map(({ capture_id }) => capture_id);
  const setStatus = async (captureId: string, status: 'approved' | 'rejected') => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query('UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
        captureId,
        status,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  expect(requiredCaptures).toHaveLength(3);
  for (const captureId of requiredCaptures) {
    await setStatus(captureId, 'rejected');
    await expect(repository.loadCurrentExact(spell.spellVersionId, scope)).rejects.toThrow();
    await setStatus(captureId, 'approved');
    expect((await repository.loadCurrentExact(spell.spellVersionId, scope)).spellVersionId).toBe(
      spell.spellVersionId
    );
  }
});

it('admits only the reviewed 2016 non-production source pair and exact boundary identities', async () => {
  const address = (kind: string, value: string) =>
    `${kind}:${createHash('sha256').update(value).digest('hex')}`;
  const candidateId = address('external-reconciliation', 'official-2016-combined-proof');
  const selectionIds = Array.from({ length: 77 }, (_, index) =>
    address('external-draft-selection', `official-2016-${index + 1}`)
  );
  const captures = [
    {
      key: 'wrap',
      url: 'https://www.afl.com.au/news/157359/all-the-picks-from-the-2016-nab-afl-draft',
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2016-11-25',
        },
        {
          kind: 'draft_session_completion',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'first',
          selectionNumber: 1,
          player: { nativeId: null, recordedName: 'Andrew McGrath' },
          selectedByClub: { nativeId: null, recordedName: 'Essendon' },
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'last',
          selectionNumber: 77,
          player: { nativeId: null, recordedName: 'Jake Waterman' },
          selectedByClub: { nativeId: null, recordedName: 'West Coast' },
        },
      ],
    },
    {
      key: 'total',
      url: 'https://www.afl.com.au/news/149290/revisiting-the-drafts-2016-national-draft',
      claims: [
        {
          kind: 'draft_completed_total',
          draftYear: 2016,
          draftType: 'national',
          selectionCount: 77,
        },
      ],
    },
    {
      key: 'date',
      url: 'https://www.afl.com.au/news/49872/indicative-draft-order-your-clubs-picks',
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2016-11-25',
        },
      ],
    },
  ] as const;
  const evidenceIds = captures
    .flatMap(({ key, claims }) =>
      claims.map((_, index) => address('external-evidence', `official-2016-${key}-${index + 1}`))
    )
    .sort();
  const fixture = await pool.connect();
  try {
    await fixture.query('BEGIN');
    await fixture.query('SET LOCAL session_replication_role=replica');
    await fixture.query(
      `INSERT INTO outcome_external_reconciliation_candidate
       (candidate_id,environment,competition,anchor_season_year,reconciled_at,source_batch_count,
        identity_resolution_count,transaction_count,transfer_count,draft_selection_count,
        pick_custody_count,pick_lineage_count,issue_count,status,finalized_at,candidate_json)
       VALUES($1,'non_production','AFLM',2016,'2026-09-11',3,4,0,0,77,0,0,0,
              'finalized','2026-09-11',$2::jsonb)`,
      [
        candidateId,
        JSON.stringify({
          content: {
            environment: 'non_production',
            competition: 'AFLM',
            anchorSeasonYear: 2016,
            publicationEligible: false,
          },
        }),
      ]
    );
    let evidenceOrdinal = 0;
    for (const [captureIndex, capture] of captures.entries()) {
      const captureId = address('source-capture', `official-2016-${capture.key}`);
      const batchId = address('external-evidence-batch', `official-2016-${capture.key}`);
      await fixture.query(
        `INSERT INTO outcome_source_capture
         (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
          dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
          captured_at,status,manifest_json)
         VALUES($1,$2,$3,$4,'non_production','official_afl','draft-session','official-2016-v1',
                'automated_web','official-afl-completed-draft-session','AFLM',2016,
                $6,'2026-09-11','approved',$5::jsonb)`,
        [
          captureId,
          `attempt-official-2016-${capture.key}`,
          `snapshot-official-2016-${capture.key}`,
          address('artifact', `official-2016-${capture.key}`),
          JSON.stringify({ sourceUrl: capture.url }),
          capture.key === 'total' ? '2019-11-28T11:30:00.000Z' : '2016-11-25T00:00:00.000Z',
        ]
      );
      await fixture.query(
        `INSERT INTO outcome_external_evidence_batch
         (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
          status,finalized_at,batch_json)
         VALUES($1,$2,'official_afl',$3,0,$4,$5,'finalized','2026-09-11','{}')`,
        [batchId, captureId, capture.claims.length, hex(String(captureIndex + 1)), hex('f')]
      );
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_source_batch(candidate_id,ordinal,batch_id)
         VALUES($1,$2,$3)`,
        [candidateId, captureIndex + 1, batchId]
      );
      for (const [rowIndex, claim] of capture.claims.entries()) {
        const evidenceId = address(
          'external-evidence',
          `official-2016-${capture.key}-${rowIndex + 1}`
        );
        evidenceOrdinal += 1;
        await fixture.query(
          `INSERT INTO outcome_external_evidence_row
           (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            evidenceId,
            batchId,
            rowIndex + 1,
            `official-2016-${evidenceOrdinal}`,
            claim.kind,
            JSON.stringify({ content: { provider: 'official_afl', claim } }),
          ]
        );
      }
    }
    for (const [index, selectionId] of selectionIds.entries()) {
      const selectionNumber = index + 1;
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_draft_selection
         (candidate_id,ordinal,selection_id,draft_year,draft_type,selection_number,pick_id,status,
          selection_json)
         VALUES($1,$2,$3,2016,'national',$2,$4,'single_source',$5::jsonb)`,
        [
          candidateId,
          selectionNumber,
          selectionId,
          address('draft-pick', `official-2016-${selectionNumber}`),
          JSON.stringify({
            pickId: address('draft-pick', `official-2016-${selectionNumber}`),
            playerId: `official-2016-player-${selectionNumber}`,
            clubId: `official-2016-club-${selectionNumber}`,
            evidenceIds,
          }),
        ]
      );
    }
    for (const [index, [kind, recordedName, canonicalId]] of [
      ['player', 'Andrew McGrath', 'official-2016-player-1'],
      ['club', 'Essendon', 'official-2016-club-1'],
      ['player', 'Jake Waterman', 'official-2016-player-77'],
      ['club', 'West Coast', 'official-2016-club-77'],
    ].entries()) {
      const decisionId = address('review-decision', `official-2016-${index + 1}`);
      await fixture.query(
        `INSERT INTO outcome_review_decision
         (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES($1,'external_identity','official-2016','approved','fixture','{}','fixture','2026-09-11')`,
        [decisionId]
      );
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_identity_resolution
         (candidate_id,ordinal,resolution_id,review_decision_id,provider,entity_kind,canonical_id,
          resolution_json)
         VALUES($1,$2,$3,$4,'official_afl',$5,$6,$7::jsonb)`,
        [
          candidateId,
          index + 1,
          address('external-identity-resolution', `official-2016-${index + 1}`),
          decisionId,
          kind,
          canonicalId,
          JSON.stringify({
            content: {
              reviewDecisionId: decisionId,
              provider: 'official_afl',
              entityKind: kind,
              canonicalId,
              sourceIdentity: { nativeId: null, recordedName },
            },
          }),
        ]
      );
    }
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  } finally {
    fixture.release();
  }

  const proposalForYear = (draftYear: number) => ({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
    proposedAt: '2026-09-11T12:00:00.000Z',
    draftEventCoverage: [
      {
        draftYear,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: `${draftYear}-11-25`,
        officialName: `${draftYear} AFL Draft`,
        expectedSelectionCount: 77,
        selectionIds,
        evidenceIds,
        status: 'complete',
        proofKind: 'combined_session_facts',
      },
    ],
  });
  const exactProposal = async (proposal: object) =>
    (
      await pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [candidateId, JSON.stringify(proposal)]
      )
    ).rows[0]!.valid;
  const exact = (draftYear = 2016) => exactProposal(proposalForYear(draftYear));
  const replicaUpdate = async (query: string, parameters: unknown[]) => {
    const revision = await pool.connect();
    try {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query(query, parameters);
      await revision.query('COMMIT');
    } catch (error) {
      await revision.query('ROLLBACK');
      throw error;
    } finally {
      revision.release();
    }
  };
  const setUrl = (key: 'wrap' | 'total' | 'date', sourceUrl: string) =>
    replicaUpdate('UPDATE outcome_source_capture SET manifest_json=$2::jsonb WHERE capture_id=$1', [
      address('source-capture', `official-2016-${key}`),
      JSON.stringify({ sourceUrl }),
    ]);

  expect(
    (
      await pool.query<{ effective_at: Date }>(
        'SELECT effective_at FROM outcome_source_capture WHERE capture_id=$1',
        [address('source-capture', 'official-2016-total')]
      )
    ).rows[0]!.effective_at.toISOString()
  ).toBe('2019-11-28T11:30:00.000Z');
  expect(await exact()).toBe(true);
  await setUrl('date', 'https://www.afl.com.au/news/49872/alternate-reviewed-slug?capture=2');
  expect(await exact()).toBe(true);
  await setUrl('date', captures[2].url);

  await setUrl('wrap', 'https://www.afl.com.au/news/99499/2018-terminal');
  await setUrl('total', 'https://www.afl.com.au/news/140672/2018-total');
  expect(await exact()).toBe(false);
  await setUrl('wrap', captures[0].url);
  await setUrl('total', captures[1].url);

  await setUrl('wrap', 'https://www.afl.com.au/news/142762/2017-terminal');
  await setUrl('total', 'https://www.afl.com.au/news/83698/2017-total');
  expect(await exact()).toBe(false);
  await setUrl('wrap', captures[0].url);
  await setUrl('total', captures[1].url);

  await setUrl('total', 'https://www.afl.com.au/news/142762/alternate-slug');
  expect(await exact()).toBe(false);
  await setUrl('total', 'https://www.afl.com.au/news/123233/club-verdict');
  expect(await exact()).toBe(false);
  await setUrl('total', 'https://www.afl.com.au/news/999999/unknown');
  expect(await exact()).toBe(false);
  await setUrl('total', captures[1].url);

  const validProposal = proposalForYear(2016);
  expect(
    await exactProposal({
      ...validProposal,
      draftEventCoverage: [
        {
          ...validProposal.draftEventCoverage[0],
          selectionIds: selectionIds.slice(0, -1),
          expectedSelectionCount: 76,
        },
      ],
    })
  ).toBe(false);
  expect(
    await exactProposal({
      ...validProposal,
      draftEventCoverage: [
        {
          ...validProposal.draftEventCoverage[0],
          selectionIds: [...selectionIds.slice(0, -1), selectionIds[0]],
        },
      ],
    })
  ).toBe(false);
  expect(
    await exactProposal({
      ...validProposal,
      draftEventCoverage: [
        {
          ...validProposal.draftEventCoverage[0],
          selectionIds: [...selectionIds.slice(0, 38), 'external-draft-selection:unknown'],
          expectedSelectionCount: 39,
        },
      ],
    })
  ).toBe(false);
  expect(
    await exactProposal({
      ...validProposal,
      draftEventCoverage: [{ ...validProposal.draftEventCoverage[0], draftType: 'rookie' }],
    })
  ).toBe(false);
  expect(
    await exactProposal({
      ...validProposal,
      draftEventCoverage: [
        ...validProposal.draftEventCoverage,
        {
          ...validProposal.draftEventCoverage[0],
          sessionOrdinal: 2,
          eventDate: '2016-11-26',
        },
      ],
    })
  ).toBe(false);

  const setCompletionKind = (claimKind: string) =>
    replicaUpdate(
      `UPDATE outcome_external_evidence_row SET claim_kind=$2
        WHERE batch_id=$1 AND evidence_json#>>'{content,claim,kind}'='draft_session_completion'`,
      [address('external-evidence-batch', 'official-2016-wrap'), claimKind]
    );
  await setCompletionKind('draft_session_date');
  expect(await exact()).toBe(false);
  await setCompletionKind('draft_session_completion');

  const setTerminalNumber = (selectionNumber: number) =>
    replicaUpdate(
      `UPDATE outcome_external_evidence_row
          SET evidence_json=jsonb_set(
            evidence_json,'{content,claim,selectionNumber}',to_jsonb($2::integer))
        WHERE batch_id=$1 AND evidence_json#>>'{content,claim,boundary}'='last'`,
      [address('external-evidence-batch', 'official-2016-wrap'), selectionNumber]
    );
  for (const selectionNumber of [76, 78]) {
    await setTerminalNumber(selectionNumber);
    expect(await exact()).toBe(false);
  }
  await setTerminalNumber(77);

  const totalBatchId = address('external-evidence-batch', 'official-2016-total');
  const totalCaptureId = address('source-capture', 'official-2016-total');
  const wrapCaptureId = address('source-capture', 'official-2016-wrap');
  await expect(
    replicaUpdate('UPDATE outcome_external_evidence_batch SET capture_id=$2 WHERE batch_id=$1', [
      totalBatchId,
      wrapCaptureId,
    ])
  ).rejects.toThrow('outcome_external_evidence_batch_capture_id_key');
  expect(await exact()).toBe(true);
  await replicaUpdate(
    'UPDATE outcome_source_capture SET source_artifact_id=$2 WHERE capture_id=$1',
    [totalCaptureId, address('artifact', 'official-2016-wrap')]
  );
  expect(await exact()).toBe(false);
  await replicaUpdate(
    'UPDATE outcome_source_capture SET source_artifact_id=$2 WHERE capture_id=$1',
    [totalCaptureId, address('artifact', 'official-2016-total')]
  );

  for (const [entityKind, canonicalId] of [
    ['player', 'official-2016-player-1'],
    ['club', 'official-2016-club-1'],
    ['player', 'official-2016-player-77'],
    ['club', 'official-2016-club-77'],
  ] as const) {
    const wrongId = `wrong-${canonicalId}`;
    await replicaUpdate(
      `UPDATE outcome_external_reconciliation_identity_resolution
          SET canonical_id=$4,
              resolution_json=jsonb_set(resolution_json,'{content,canonicalId}',to_jsonb($4::text))
        WHERE candidate_id=$1 AND entity_kind=$2 AND canonical_id=$3`,
      [candidateId, entityKind, canonicalId, wrongId]
    );
    expect(await exact()).toBe(false);
    await replicaUpdate(
      `UPDATE outcome_external_reconciliation_identity_resolution
          SET canonical_id=$4,
              resolution_json=jsonb_set(resolution_json,'{content,canonicalId}',to_jsonb($4::text))
        WHERE candidate_id=$1 AND entity_kind=$2 AND canonical_id=$3`,
      [candidateId, entityKind, wrongId, canonicalId]
    );
    expect(await exact()).toBe(true);
  }

  const setDraftYear = async (draftYear: number) => {
    await replicaUpdate(
      `UPDATE outcome_external_reconciliation_candidate
          SET anchor_season_year=$2,
              candidate_json=jsonb_set(
                candidate_json,'{content,anchorSeasonYear}',to_jsonb($2::integer))
        WHERE candidate_id=$1`,
      [candidateId, draftYear]
    );
    await replicaUpdate(
      `UPDATE outcome_source_capture SET anchor_season_year=$2
        WHERE capture_id IN (
          SELECT batch.capture_id FROM outcome_external_reconciliation_source_batch source
          JOIN outcome_external_evidence_batch batch USING(batch_id)
          WHERE source.candidate_id=$1)`,
      [candidateId, draftYear]
    );
    await replicaUpdate(
      `UPDATE outcome_external_reconciliation_draft_selection SET draft_year=$2
        WHERE candidate_id=$1`,
      [candidateId, draftYear]
    );
    await replicaUpdate(
      `UPDATE outcome_external_evidence_row
          SET evidence_json=CASE
                WHEN evidence_json#>>'{content,claim,eventDate}' IS NULL
                  THEN jsonb_set(
                    evidence_json,'{content,claim,draftYear}',to_jsonb($2::integer))
                ELSE jsonb_set(
                  jsonb_set(evidence_json,'{content,claim,draftYear}',to_jsonb($2::integer)),
                  '{content,claim,eventDate}',to_jsonb(($2::text || '-11-25')::text))
              END
        WHERE batch_id IN (
          SELECT batch_id FROM outcome_external_reconciliation_source_batch WHERE candidate_id=$1)`,
      [candidateId, draftYear]
    );
  };
  await setDraftYear(2018);
  expect(await exact(2018)).toBe(false);
  await setDraftYear(2019);
  expect(await exact(2019)).toBe(false);
  await setDraftYear(2016);
  expect(await exact()).toBe(true);

  await replicaUpdate(
    `UPDATE outcome_source_capture SET status='rejected'
      WHERE capture_id=$1`,
    [address('source-capture', 'official-2016-date')]
  );
  expect(await exact()).toBe(false);
  await replicaUpdate(
    `UPDATE outcome_source_capture SET status='approved'
      WHERE capture_id=$1`,
    [address('source-capture', 'official-2016-date')]
  );
  expect(await exact()).toBe(true);
});

it('admits only the reviewed 2017 non-production source pair and exact boundary identities', async () => {
  const address = (kind: string, value: string) =>
    `${kind}:${createHash('sha256').update(value).digest('hex')}`;
  const candidateId = address('external-reconciliation', 'official-2017-combined-proof');
  const selectionIds = Array.from({ length: 78 }, (_, index) =>
    address('external-draft-selection', `official-2017-${index + 1}`)
  );
  const captures = [
    {
      key: 'wrap',
      url: 'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call',
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2017,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2017-11-24',
        },
        {
          kind: 'draft_session_completion',
          draftYear: 2017,
          draftType: 'national',
          sessionOrdinal: 1,
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2017,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'first',
          selectionNumber: 1,
          player: { nativeId: null, recordedName: 'Cameron Rayner' },
          selectedByClub: { nativeId: null, recordedName: 'Brisbane Lions' },
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2017,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'last',
          selectionNumber: 78,
          player: { nativeId: null, recordedName: 'Jarrod Garlett' },
          selectedByClub: { nativeId: null, recordedName: 'Carlton' },
        },
      ],
    },
    {
      key: 'total',
      url: 'https://www.afl.com.au/news/83698/broadcast-guide-premiership',
      claims: [
        {
          kind: 'draft_completed_total',
          draftYear: 2017,
          draftType: 'national',
          selectionCount: 78,
        },
      ],
    },
    {
      key: 'date',
      url: 'https://www.afl.com.au/news/46107/final-draft-order-check-out-all-of-your-clubs-picks',
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2017,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2017-11-24',
        },
      ],
    },
  ] as const;
  const evidenceIds = captures
    .flatMap(({ key, claims }) =>
      claims.map((_, index) => address('external-evidence', `official-2017-${key}-${index + 1}`))
    )
    .sort();
  const fixture = await pool.connect();
  try {
    await fixture.query('BEGIN');
    await fixture.query('SET LOCAL session_replication_role=replica');
    await fixture.query(
      `INSERT INTO outcome_external_reconciliation_candidate
       (candidate_id,environment,competition,anchor_season_year,reconciled_at,source_batch_count,
        identity_resolution_count,transaction_count,transfer_count,draft_selection_count,
        pick_custody_count,pick_lineage_count,issue_count,status,finalized_at,candidate_json)
       VALUES($1,'non_production','AFLM',2017,'2017-11-25',3,4,0,0,78,0,0,0,
              'finalized','2017-11-25',$2::jsonb)`,
      [
        candidateId,
        JSON.stringify({
          content: {
            environment: 'non_production',
            competition: 'AFLM',
            anchorSeasonYear: 2017,
            publicationEligible: false,
          },
        }),
      ]
    );
    let evidenceOrdinal = 0;
    for (const [captureIndex, capture] of captures.entries()) {
      const captureId = address('source-capture', `official-2017-${capture.key}`);
      const batchId = address('external-evidence-batch', `official-2017-${capture.key}`);
      await fixture.query(
        `INSERT INTO outcome_source_capture
         (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
          dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
          captured_at,status,manifest_json)
         VALUES($1,$2,$3,$4,'non_production','official_afl','draft-session','official-2017-v1',
                'automated_web','official-afl-completed-draft-session','AFLM',2017,
                '2017-11-25','2017-11-25','approved',$5::jsonb)`,
        [
          captureId,
          `attempt-official-2017-${capture.key}`,
          `snapshot-official-2017-${capture.key}`,
          address('artifact', `official-2017-${capture.key}`),
          JSON.stringify({ sourceUrl: capture.url }),
        ]
      );
      await fixture.query(
        `INSERT INTO outcome_external_evidence_batch
         (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
          status,finalized_at,batch_json)
         VALUES($1,$2,'official_afl',$3,0,$4,$5,'finalized','2017-11-25','{}')`,
        [batchId, captureId, capture.claims.length, hex(String(captureIndex + 1)), hex('f')]
      );
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_source_batch(candidate_id,ordinal,batch_id)
         VALUES($1,$2,$3)`,
        [candidateId, captureIndex + 1, batchId]
      );
      for (const [rowIndex, claim] of capture.claims.entries()) {
        const evidenceId = address(
          'external-evidence',
          `official-2017-${capture.key}-${rowIndex + 1}`
        );
        evidenceOrdinal += 1;
        await fixture.query(
          `INSERT INTO outcome_external_evidence_row
           (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            evidenceId,
            batchId,
            rowIndex + 1,
            `official-2017-${evidenceOrdinal}`,
            claim.kind,
            JSON.stringify({ content: { provider: 'official_afl', claim } }),
          ]
        );
      }
    }
    for (const [index, selectionId] of selectionIds.entries()) {
      const selectionNumber = index + 1;
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_draft_selection
         (candidate_id,ordinal,selection_id,draft_year,draft_type,selection_number,pick_id,status,
          selection_json)
         VALUES($1,$2,$3,2017,'national',$2,$4,'single_source',$5::jsonb)`,
        [
          candidateId,
          selectionNumber,
          selectionId,
          address('draft-pick', `official-2017-${selectionNumber}`),
          JSON.stringify({
            pickId: address('draft-pick', `official-2017-${selectionNumber}`),
            playerId: `official-2017-player-${selectionNumber}`,
            clubId: `official-2017-club-${selectionNumber}`,
            evidenceIds,
          }),
        ]
      );
    }
    for (const [index, [kind, recordedName, canonicalId]] of [
      ['player', 'Cameron Rayner', 'official-2017-player-1'],
      ['club', 'Brisbane Lions', 'official-2017-club-1'],
      ['player', 'Jarrod Garlett', 'official-2017-player-78'],
      ['club', 'Carlton', 'official-2017-club-78'],
    ].entries()) {
      const decisionId = address('review-decision', `official-2017-${index + 1}`);
      await fixture.query(
        `INSERT INTO outcome_review_decision
         (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES($1,'external_identity','official-2017','approved','fixture','{}','fixture','2017-11-25')`,
        [decisionId]
      );
      await fixture.query(
        `INSERT INTO outcome_external_reconciliation_identity_resolution
         (candidate_id,ordinal,resolution_id,review_decision_id,provider,entity_kind,canonical_id,
          resolution_json)
         VALUES($1,$2,$3,$4,'official_afl',$5,$6,$7::jsonb)`,
        [
          candidateId,
          index + 1,
          address('external-identity-resolution', `official-2017-${index + 1}`),
          decisionId,
          kind,
          canonicalId,
          JSON.stringify({
            content: {
              reviewDecisionId: decisionId,
              provider: 'official_afl',
              entityKind: kind,
              canonicalId,
              sourceIdentity: { nativeId: null, recordedName },
            },
          }),
        ]
      );
    }
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  } finally {
    fixture.release();
  }

  const proposalForYear = (draftYear: number) => ({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
    proposedAt: `${draftYear}-11-25T12:00:00.000Z`,
    draftEventCoverage: [
      {
        draftYear,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: `${draftYear}-11-24`,
        officialName: `${draftYear} AFL Draft`,
        expectedSelectionCount: 78,
        selectionIds,
        evidenceIds,
        status: 'complete',
        proofKind: 'combined_session_facts',
      },
    ],
  });
  const exact = async (draftYear = 2017) =>
    (
      await pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [candidateId, JSON.stringify(proposalForYear(draftYear))]
      )
    ).rows[0]!.valid;
  const replicaUpdate = async (query: string, parameters: unknown[]) => {
    const revision = await pool.connect();
    try {
      await revision.query('BEGIN');
      await revision.query('SET LOCAL session_replication_role=replica');
      await revision.query(query, parameters);
      await revision.query('COMMIT');
    } catch (error) {
      await revision.query('ROLLBACK');
      throw error;
    } finally {
      revision.release();
    }
  };
  const setUrl = (key: 'wrap' | 'total' | 'date', sourceUrl: string) =>
    replicaUpdate('UPDATE outcome_source_capture SET manifest_json=$2::jsonb WHERE capture_id=$1', [
      address('source-capture', `official-2017-${key}`),
      JSON.stringify({ sourceUrl }),
    ]);

  expect(await exact()).toBe(true);
  await setUrl('wrap', 'https://www.afl.com.au/news/99499/2018-terminal');
  await setUrl('total', 'https://www.afl.com.au/news/140672/2018-total');
  expect(await exact()).toBe(false);
  await setUrl('wrap', captures[0].url);
  await setUrl('total', captures[1].url);

  await setUrl('total', 'https://www.afl.com.au/news/142762/alternate-slug');
  expect(await exact()).toBe(false);
  await setUrl('total', 'https://www.afl.com.au/news/999999/unknown');
  expect(await exact()).toBe(false);
  await setUrl('total', captures[1].url);

  await replicaUpdate(
    `UPDATE outcome_external_reconciliation_identity_resolution
        SET canonical_id='wrong-carlton',
            resolution_json=jsonb_set(resolution_json,'{content,canonicalId}',to_jsonb('wrong-carlton'::text))
      WHERE candidate_id=$1 AND entity_kind='club' AND canonical_id='official-2017-club-78'`,
    [candidateId]
  );
  expect(await exact()).toBe(false);
  await replicaUpdate(
    `UPDATE outcome_external_reconciliation_identity_resolution
        SET canonical_id='official-2017-club-78',
            resolution_json=jsonb_set(resolution_json,'{content,canonicalId}',to_jsonb('official-2017-club-78'::text))
      WHERE candidate_id=$1 AND entity_kind='club' AND canonical_id='wrong-carlton'`,
    [candidateId]
  );

  const setDraftYear = async (draftYear: number) => {
    await replicaUpdate(
      `UPDATE outcome_external_reconciliation_draft_selection SET draft_year=$2
        WHERE candidate_id=$1`,
      [candidateId, draftYear]
    );
    await replicaUpdate(
      `UPDATE outcome_external_evidence_row
          SET evidence_json=CASE
                WHEN evidence_json#>>'{content,claim,eventDate}' IS NULL
                  THEN jsonb_set(
                    evidence_json,'{content,claim,draftYear}',to_jsonb($2::integer))
                ELSE jsonb_set(
                  jsonb_set(evidence_json,'{content,claim,draftYear}',to_jsonb($2::integer)),
                  '{content,claim,eventDate}',to_jsonb(($2::text || '-11-24')::text))
              END
        WHERE batch_id IN (
          SELECT batch_id FROM outcome_external_reconciliation_source_batch WHERE candidate_id=$1)`,
      [candidateId, draftYear]
    );
  };
  await setDraftYear(2018);
  expect(await exact(2018)).toBe(false);
  await setDraftYear(2019);
  expect(await exact(2019)).toBe(false);
  await setDraftYear(2017);
  expect(await exact()).toBe(true);

  await replicaUpdate(
    `UPDATE outcome_source_capture SET status='rejected'
      WHERE capture_id=$1`,
    [address('source-capture', 'official-2017-date')]
  );
  expect(await exact()).toBe(false);
  await replicaUpdate(
    `UPDATE outcome_source_capture SET status='approved'
      WHERE capture_id=$1`,
    [address('source-capture', 'official-2017-date')]
  );
  expect(await exact()).toBe(true);
});

it('binds boundary identity reviews to the matching entity kind and draft year', async () => {
  const sql = createPgAflOutcomeSqlClient(pool);
  const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const now = (
    await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
  ).rows[0]!.at;
  const capturedAt = new Date(now.getTime() - 2_000).toISOString();
  const completedAt = new Date(now.getTime() - 1_000).toISOString();
  const completionId = `external-historical-capture-completion:${hex('0')}`;
  const captureId = `source-capture:${hex('0')}`;
  const batchId = `external-evidence-batch:${hex('0')}`;
  const evidenceId = `external-evidence:${hex('0')}`;
  const authorityEvidenceId = `reviewer-authority-evidence:${hex('d')}`;
  const authorityApprovalId = `review-decision:${hex('d')}`;
  const boundaryClaim = {
    kind: 'draft_session_boundary',
    draftYear: 2024,
    draftType: 'national',
    sessionOrdinal: 1,
    boundary: 'first',
    selectionNumber: 1,
    player: { nativeId: null, recordedName: 'Boundary Player' },
    selectedByClub: { nativeId: null, recordedName: 'Boundary Club' },
  } as const;
  const fixture = await pool.connect();
  try {
    await fixture.query('BEGIN');
    await fixture.query('SET LOCAL session_replication_role=replica');
    await fixture.query(
      `INSERT INTO outcome_source_capture
       (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
        dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
        captured_at,status,manifest_json)
       VALUES($1,'boundary-attempt','boundary-snapshot',$2,'test_fixture','official_afl',
              'draft-session','fixture-v1','automated_web','official-afl-completed-draft-session',
              'AFLM',2024,$3,$3,'approved','{}'::jsonb)`,
      [captureId, `artifact:${hex('0')}`, capturedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_external_evidence_batch
       (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
        status,finalized_at,batch_json)
       VALUES($1,$2,'official_afl',1,0,$3,$4,'finalized',$5,'{}'::jsonb)`,
      [batchId, captureId, hex('0'), hex('1'), capturedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_external_evidence_row
       (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       VALUES($1,$2,1,'boundary','draft_session_boundary',$3::jsonb)`,
      [
        evidenceId,
        batchId,
        JSON.stringify({
          content: {
            provider: 'official_afl',
            capture: { capturedAt },
            claim: boundaryClaim,
          },
        }),
      ]
    );
    await fixture.query(
      `INSERT INTO outcome_external_historical_capture_completion
       (completion_id,plan_id,environment,competition,target_count,result_set_sha256,
        source_batch_set_sha256,completed_at,status,reconciliation_eligible,finalized_at,
        completion_json,completion_canonical_json)
       VALUES($1,'boundary-plan','test_fixture','AFLM',1,$2,$3,$4,'complete',TRUE,$4,
              '{}'::jsonb,'{}')`,
      [completionId, hex('2'), hex('3'), completedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_external_historical_capture_completion_result
       (completion_id,ordinal,plan_id,target_id,schedule_id,dispatch_key,occurrence_event_id,
        occurrence_revision,capture_mode,result_id,capture_id,evidence_batch_id,evidence_count,
        finalized_at,result_json)
       VALUES($1,1,'boundary-plan','boundary-target','boundary-schedule','boundary-dispatch',
              'boundary-event',1,'captured',$2,$3,$4,1,$5,'{}'::jsonb)`,
      [completionId, batchId, captureId, batchId, capturedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES($1,'governed_evidence_reference',$2,'approved','Boundary authority','{}'::jsonb,
              'fixture-governance',$3)`,
      [authorityApprovalId, authorityEvidenceId, capturedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_governed_evidence_reference
       (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
        approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,'{}','{}')`,
      [authorityEvidenceId, hex('d'), `artifact:${hex('e')}`, authorityApprovalId, capturedAt]
    );
    await fixture.query(
      `INSERT INTO outcome_operational_principal_authority
       (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,
        valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES($1,'operator:boundary-review','afl_trade_external_identity_reviewer',
              'public-afl-draft-trade-outcomes','official_afl','external_identity_resolution',
              'AFLM',2023,2024,$2,NULL)`,
      [authorityEvidenceId, capturedAt]
    );
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  } finally {
    fixture.release();
  }

  const targets = [
    ['player', 'boundary-player', 'Boundary Player'],
    ['club', 'boundary-club', 'Boundary Club'],
    ['player', 'wrong-kind-player', 'Boundary Club'],
    ['player', 'wrong-year-player', 'Boundary Player'],
  ] as const;
  await pool.query(
    `INSERT INTO outcome_player(player_id,display_name,status)
     VALUES($1,$2,'approved'),($3,$4,'approved'),($5,$6,'approved')`,
    [targets[0][1], targets[0][2], targets[2][1], targets[2][2], targets[3][1], targets[3][2]]
  );
  await pool.query(
    `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved')`,
    [targets[1][1], targets[1][2]]
  );

  const persist = async (input: {
    entityKind: 'player' | 'club';
    recordedName: string;
    seasonYear: number;
    canonicalId: string;
  }) => {
    const subject = createAflTradeExternalIdentitySubject({
      environment: 'test_fixture',
      competition: 'AFLM',
      provider: 'official_afl',
      entityKind: input.entityKind,
      identityScope: {
        kind: 'exact_recorded_name',
        recordedName: input.recordedName,
        seasonYear: input.seasonYear,
      },
    });
    const workItem = createAflTradeExternalIdentityReviewWorkItem({
      subject,
      observations: [
        {
          evidenceId,
          batchId,
          sourceIdentity: { nativeId: null, recordedName: input.recordedName },
          seasonYear: input.seasonYear,
          capturedAt,
        },
      ],
    });
    const reviewPackage = createAflTradeExternalIdentityReviewPackage({
      completionId,
      completionSha256: hex('0'),
      environment: 'test_fixture',
      competition: 'AFLM',
      completedAt,
      items: [workItem],
    });
    const decision = createAflTradeExternalIdentityReviewDecision({
      subject,
      reviewPackageId: reviewPackage.packageId,
      reviewPackageSha256: reviewPackage.packageId.split(':')[1]!,
      workItemId: workItem.workItemId,
      workItemSha256: workItem.workItemId.split(':')[1]!,
      workItem,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
        entityKind: input.entityKind,
        canonicalId: input.canonicalId,
        recordedLabel: input.recordedName,
      }),
      rationale: 'Boundary identity guard fixture',
      authorityEvidenceId,
      decidedBy: 'operator:boundary-review',
      decidedAt: (
        await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
      ).rows[0]!.at.toISOString(),
    });
    return repository.persistDecision({ reviewPackage, decision });
  };

  await pool.query(
    'ALTER TABLE outcome_external_identity_review_decision DISABLE TRIGGER outcome_external_retained_identity_source_guard'
  );
  try {
    await expect(
      persist({
        entityKind: 'player',
        recordedName: 'Boundary Player',
        seasonYear: 2024,
        canonicalId: 'boundary-player',
      })
    ).resolves.toMatchObject({ status: 'approved' });
    await expect(
      persist({
        entityKind: 'club',
        recordedName: 'Boundary Club',
        seasonYear: 2024,
        canonicalId: 'boundary-club',
      })
    ).resolves.toMatchObject({ status: 'approved' });
    await expect(
      persist({
        entityKind: 'player',
        recordedName: 'Boundary Club',
        seasonYear: 2024,
        canonicalId: 'wrong-kind-player',
      })
    ).rejects.toThrow(/observation does not match its exact source identity/i);
    await expect(
      persist({
        entityKind: 'player',
        recordedName: 'Boundary Player',
        seasonYear: 2023,
        canonicalId: 'wrong-year-player',
      })
    ).rejects.toThrow(/observation does not match its exact source identity/i);
  } finally {
    await pool.query(
      'ALTER TABLE outcome_external_identity_review_decision ENABLE TRIGGER outcome_external_retained_identity_source_guard'
    );
  }
});

it('rejects malformed and ambiguous multi-document membership joins in SQL', async () => {
  const roster = {
    evidenceId: 'roster',
    captureId: 'capture1',
    artifactId: 'artifact1',
    documentId: 'doc1',
    claim: {
      kind: 'draft_completed_membership_roster',
      draftYear: 2014,
      draftType: 'national',
      members: [
        { recordedName: 'One', selectionNumber: 1 },
        { recordedName: 'Academy', selectionNumber: null },
      ],
    },
  };
  const binding = {
    evidenceId: 'binding',
    captureId: 'capture2',
    artifactId: 'artifact2',
    documentId: 'doc2',
    claim: {
      kind: 'draft_completed_member_number',
      draftYear: 2014,
      draftType: 'national',
      recordedName: 'Academy',
      selectionNumber: 85,
    },
  };
  const verify = async (facts: unknown, numbers: unknown = [1, 85]) =>
    (
      await pool.query(
        "SELECT outcome_completed_membership_exact($1::jsonb,$2::jsonb,2014,'national') AS valid",
        [JSON.stringify(facts), JSON.stringify(numbers)]
      )
    ).rows[0].valid;
  expect(await verify([roster, binding])).toBe(true);
  for (const changed of [
    [],
    [{ recordedName: 'One', selectionNumber: 1 }],
    [
      { recordedName: 'One', selectionNumber: 1 },
      { recordedName: 'One', selectionNumber: null },
    ],
    [{ recordedName: 'One', selectionNumber: 1 }, { recordedName: 'Academy' }],
    [
      { recordedName: 'One', selectionNumber: 1 },
      { recordedName: 'Academy', selectionNumber: 85 },
    ],
  ])
    expect(
      await verify([{ ...roster, claim: { ...roster.claim, members: changed } }, binding])
    ).toBe(false);
  for (const changed of [
    { ...binding, captureId: 'capture1' },
    { ...binding, artifactId: 'artifact1' },
    { ...binding, documentId: 'doc1' },
    { ...binding, evidenceId: '' },
    { ...binding, claim: { ...binding.claim, selectionNumber: 1 } },
    { ...binding, claim: { ...binding.claim, selectionNumber: 85.5 } },
    { ...binding, claim: { ...binding.claim, recordedName: 'Other' } },
    { ...binding, claim: { ...binding.claim, draftYear: 2013 } },
    { ...binding, claim: { ...binding.claim, draftType: 'rookie' } },
  ])
    expect(await verify([roster, changed])).toBe(false);
  expect(await verify([roster])).toBe(false);
  expect(await verify([binding])).toBe(false);
  expect(
    await verify([
      {
        ...roster,
        claim: {
          ...roster.claim,
          members: [
            { recordedName: 'One', selectionNumber: 1 },
            { recordedName: 'Academy', selectionNumber: 85 },
          ],
        },
      },
      { ...binding, claim: {} },
    ])
  ).toBe(false);
  expect(await verify([roster, binding, { ...binding, evidenceId: 'duplicate' }])).toBe(false);
  expect(await verify([roster, binding], [1, 2])).toBe(false);
});

it('requires exact independent rookie-elevation classifications before excluding roster members', async () => {
  const roster = {
    evidenceId: 'roster',
    captureId: 'capture1',
    artifactId: 'artifact1',
    documentId: 'doc1',
    claim: {
      kind: 'draft_completed_membership_roster',
      draftYear: 2012,
      draftType: 'national',
      members: [
        { recordedName: 'First', selectionNumber: 1 },
        { recordedName: 'Elevated', selectionNumber: 57 },
        { recordedName: 'Last', selectionNumber: 88 },
      ],
    },
  };
  const exclusion = {
    evidenceId: 'classification',
    captureId: 'capture2',
    artifactId: 'artifact2',
    documentId: 'doc2',
    claim: {
      kind: 'draft_completed_member_exclusion',
      draftYear: 2012,
      draftType: 'national',
      recordedName: 'Elevated',
      reason: 'rookie_elevation',
    },
  };
  const verify = async (facts: unknown, numbers: unknown = [1, 88]) =>
    (
      await pool.query(
        "SELECT outcome_completed_membership_exact($1::jsonb,$2::jsonb,2012,'national') AS valid",
        [JSON.stringify(facts), JSON.stringify(numbers)]
      )
    ).rows[0].valid;
  expect(await verify([roster, exclusion])).toBe(true);
  expect(await verify([roster])).toBe(false);
  expect(await verify([exclusion])).toBe(false);
  expect(await verify([roster, exclusion, { ...exclusion, evidenceId: 'duplicate' }])).toBe(false);
  for (const changed of [
    { ...exclusion, captureId: 'capture1' },
    { ...exclusion, artifactId: 'artifact1' },
    { ...exclusion, documentId: 'doc1' },
    { ...exclusion, evidenceId: '' },
    { ...exclusion, claim: { ...exclusion.claim, recordedName: 'Other' } },
    { ...exclusion, claim: { ...exclusion.claim, recordedName: null } },
    { ...exclusion, claim: { ...exclusion.claim, reason: 'passed' } },
    { ...exclusion, claim: { ...exclusion.claim, reason: null } },
    { ...exclusion, claim: { ...exclusion.claim, draftYear: 2011 } },
    { ...exclusion, claim: { ...exclusion.claim, draftType: 'rookie' } },
    { ...exclusion, claim: { ...exclusion.claim, kind: null } },
  ])
    expect(await verify([roster, changed])).toBe(false);
  for (const number of [null, 0, 88, 57.5]) {
    const changed = {
      ...roster,
      claim: {
        ...roster.claim,
        members: roster.claim.members.map((m) =>
          m.recordedName === 'Elevated' ? { ...m, selectionNumber: number } : m
        ),
      },
    };
    expect(await verify([changed, exclusion])).toBe(false);
  }
  expect(await verify([roster, exclusion], [1, 57])).toBe(false);
  expect(await verify([roster, exclusion], [1, 2])).toBe(false);
});

const discrepancyFixture = () => ({
  draftYear: 2011,
  draftType: 'national',
  inventoryNumbers: [1, 71],
  roster: {
    kind: 'completed_draft_membership_roster' as const,
    draftYear: 2011,
    draftType: 'national',
    evidenceId: 'roster-evidence',
    captureId: 'roster-capture',
    artifactId: 'roster-artifact',
    documentId: 'official_afl:news:506746',
    members: [
      { recordedName: 'Jonathon Patton', selectionNumber: 1 },
      { recordedName: 'Cameron Sutcliffe', selectionNumber: 72 },
    ],
  },
  bindings: [
    {
      kind: 'completed_draft_member_number' as const,
      draftYear: 2011,
      draftType: 'national',
      evidenceId: 'club-evidence',
      captureId: 'club-capture',
      artifactId: 'club-artifact',
      documentId: 'official_afl:news:75034',
      recordedName: 'Cameron Sutcliffe',
      selectionNumber: 71,
    },
  ],
});

it('authenticates only the reviewed 2011 membership number pair in SQL', async () => {
  const exact = async (input: ReturnType<typeof discrepancyFixture>) => {
    const fact = ({
      kind,
      draftYear,
      draftType,
      ...source
    }: typeof input.roster | (typeof input.bindings)[number]) => {
      const { evidenceId, captureId, artifactId, documentId, ...values } = source;
      return {
        evidenceId,
        captureId,
        artifactId,
        documentId,
        claim: {
          kind:
            kind === 'completed_draft_membership_roster'
              ? 'draft_completed_membership_roster'
              : 'draft_completed_member_number',
          draftYear,
          draftType,
          ...values,
        },
      };
    };
    return (
      await pool.query(
        'SELECT outcome_completed_membership_exact($1::jsonb,$2::jsonb,$3,$4) AS valid',
        [
          JSON.stringify([fact(input.roster), ...input.bindings.map(fact)]),
          JSON.stringify(input.inventoryNumbers),
          input.draftYear,
          input.draftType,
        ]
      )
    ).rows[0].valid;
  };
  expect(await exact(discrepancyFixture())).toBe(true);
  for (const mode of [
    'year',
    'type',
    'roster-document',
    'binding-document',
    'name',
    'reported-number',
    'selected-number',
    'capture',
    'artifact',
    'evidence',
    'missing',
    'duplicate',
    'raw-duplicate',
    'inventory',
  ] as const) {
    const input = discrepancyFixture();
    if (mode === 'year') {
      input.draftYear = 2012;
      input.roster.draftYear = 2012;
      input.bindings[0]!.draftYear = 2012;
    }
    if (mode === 'type') {
      input.draftType = 'rookie';
      input.roster.draftType = 'rookie';
      input.bindings[0]!.draftType = 'rookie';
    }
    if (mode === 'roster-document') input.roster.documentId = 'official_afl:news:75034';
    if (mode === 'binding-document') input.bindings[0]!.documentId = 'official_afl:news:unknown';
    if (mode === 'name') {
      input.roster.members[1]!.recordedName = 'Another Player';
      input.bindings[0]!.recordedName = 'Another Player';
    }
    if (mode === 'reported-number') input.roster.members[1]!.selectionNumber = 73;
    if (mode === 'selected-number') {
      input.bindings[0]!.selectionNumber = 70;
      input.inventoryNumbers = [1, 70];
    }
    if (mode === 'capture') input.bindings[0]!.captureId = input.roster.captureId;
    if (mode === 'artifact') input.bindings[0]!.artifactId = input.roster.artifactId;
    if (mode === 'evidence') input.bindings[0]!.evidenceId = input.roster.evidenceId;
    if (mode === 'missing') input.bindings = [];
    if (mode === 'duplicate') input.bindings.push({ ...input.bindings[0]!, evidenceId: 'another' });
    if (mode === 'raw-duplicate') {
      input.roster.members[0]!.selectionNumber = 72;
      input.inventoryNumbers = [71, 72];
    }
    if (mode === 'inventory') input.inventoryNumbers = [1, 72];
    expect(await exact(input), mode).toBe(false);
  }
});

it('scopes reviewed mini-draft document keys to exact URLs, years and pathway', async () => {
  const urls = [
    'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
    'https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine',
    'https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final',
  ];
  for (const source of urls) {
    const key = async (url: string, year: number, type: string) =>
      (
        await pool.query('SELECT outcome_official_mini_2011_document_key($1,$2,$3) AS key', [
          url,
          year,
          type,
        ])
      ).rows[0].key;
    expect(await key(source, 2011, 'mini_draft')).toBe(source);
    expect(await key(source, 2012, 'mini_draft')).toBe(source === urls[0] ? source : null);
    expect(await key(source, 2011, 'national')).toBeNull();
    expect(await key(source + '?unreviewed=1', 2011, 'mini_draft')).toBeNull();
    expect(
      await key(source.replace(new URL(source).hostname, 'unreviewed.example'), 2011, 'mini_draft')
    ).toBeNull();
  }
  expect(
    (
      await pool.query(
        "SELECT outcome_official_mini_2011_document_key('https://www.afl.com.au/news/506746/national-draft-all-the-picks',2011,'national') AS key"
      )
    ).rows[0].key
  ).toBe('506746');
});

it('validates SQL date windows without manufacturing an exact day or permitting legacy windows', async () => {
  const exact = { draftYear: 2012, eventDate: '2012-10-08' };
  const datePrecision = {
    precision: 'window',
    eventDate: null,
    earliestDate: '2012-10-08',
    latestDate: '2012-10-26',
  };
  const session = { ...exact, eventDate: null, datePrecision };
  const bounds = async (value: unknown, allow = true) =>
    (
      await pool.query('SELECT outcome_session_precision_bounds($1::jsonb,$2)::text AS bounds', [
        JSON.stringify(value),
        allow,
      ])
    ).rows[0].bounds;
  expect(await bounds(session)).toBe('[2012-10-08,2012-10-27)');
  expect(await bounds(exact, false)).toBe('[2012-10-08,2012-10-09)');
  expect(await bounds(session, false)).toBeNull();
  for (const value of [
    { ...session, eventDate: '2012-10-26' },
    { ...session, datePrecision: null },
    { ...session, draftYear: 2011 },
    { ...session, datePrecision: { ...datePrecision, extra: true } },
    ...['2012-10-08', '2012-10-07', '2013-01-01', '2012-02-30', 'infinity'].map((latestDate) => ({
      ...session,
      datePrecision: { ...datePrecision, latestDate },
    })),
  ])
    expect(await bounds(value)).toBeNull();
});

it('preserves window bounds and membership across SQL reviewed transitions', async () => {
  const selection = {
    selectionId: 'selection',
    draftYear: 2012,
    draftType: 'mini_draft',
    evidenceIds: ['evidence'],
  };
  const parent = {
    candidateId: 'parent',
    content: {
      environment: 'test_fixture',
      reviewedCorrection: {},
      reviewedScope: { deferredEvidenceIds: [] },
      draftSelections: [selection],
      sourceBatchIds: ['old'],
      identityResolutionIds: [],
      reconciledAt: '2026-01-01T00:00:00Z',
    },
  };
  const datePrecision = {
    precision: 'window',
    eventDate: null,
    earliestDate: '2012-10-08',
    latestDate: '2012-10-26',
  };
  const session = {
    draftYear: 2012,
    draftType: 'mini_draft',
    officialName: 'Synthetic mini draft',
    sessionOrdinal: 1,
    eventDate: null,
    datePrecision,
    selectionIds: ['selection'],
    evidenceIds: ['evidence'],
  };
  const projection = {
    schemaVersion: 'afl-trade-combined-draft-session-projection/v2',
    inventorySelectionIds: ['selection'],
    selectedSelectionIds: ['selection'],
    inventorySessions: [session],
    selectedSessions: [session],
  };
  const successor = {
    content: {
      ...parent.content,
      sourceBatchIds: ['old', 'new'],
      sourceAuthority: { completionId: 'completion' },
      reviewedSessionCorrection: {
        schemaVersion: 'afl-trade-reviewed-session-correction/v1',
        parentCandidateId: 'parent',
        sourceCompletionId: 'completion',
        projections: [projection],
      },
    },
  };
  const valid = async (document: unknown) =>
    (
      await pool.query(
        'SELECT outcome_reviewed_session_transition_exact($1::jsonb,$2::jsonb) AS valid',
        [JSON.stringify(parent), JSON.stringify(document)]
      )
    ).rows[0].valid;
  expect(await valid(successor)).toBe(true);
  for (const change of [
    (p: typeof projection) => {
      p.schemaVersion = 'afl-trade-combined-draft-session-projection/v1';
    },
    (p: typeof projection) => {
      p.selectedSessions[0]!.datePrecision.latestDate = '2012-10-27';
    },
    (p: typeof projection) => {
      p.inventorySessions[0]!.selectionIds = ['different'];
    },
    (p: typeof projection) => {
      p.inventorySessions[0]!.sessionOrdinal = 2;
    },
  ]) {
    const changed = JSON.parse(JSON.stringify(successor)) as typeof successor;
    change(changed.content.reviewedSessionCorrection.projections[0]!);
    expect(await valid(changed)).toBe(false);
  }
  const ordered = JSON.parse(JSON.stringify(successor)) as typeof successor;
  const group = ordered.content.reviewedSessionCorrection.projections[0]!;
  group.inventorySelectionIds = ['earlier', 'selection'];
  const later = {
    ...session,
    sessionOrdinal: 2,
    datePrecision: { ...datePrecision, earliestDate: '2012-10-11' },
  };
  group.inventorySessions = [
    {
      ...session,
      selectionIds: ['earlier'],
      datePrecision: { ...datePrecision, latestDate: '2012-10-10' },
    },
    later,
  ];
  group.selectedSessions = [later];
  expect(await valid(ordered)).toBe(true);
  later.datePrecision.earliestDate = '2012-10-10';
  expect(await valid(ordered)).toBe(false);
});

it('admits only the exact2012 closing-paperwork source scope', async () => {
  const source =
    'https://www.afl.com.au/news/453694/official-paperwork-close-to-gillette-afl-trade-period-friday-october-26';
  const key = async (url: string, year = 2012, type = 'mini_draft') =>
    (
      await pool.query('SELECT outcome_official_mini_2011_document_key($1,$2,$3) AS key', [
        url,
        year,
        type,
      ])
    ).rows[0].key;
  expect(await key(source)).toBe('453694');
  expect(await key(source, 2011)).toBeNull();
  expect(await key(source, 2012, 'national')).toBeNull();
  expect(await key(source + '?unreviewed=1')).toBeNull();
  expect(await key(source + '-unreviewed')).toBeNull();
});

it('authenticates explicit capacity exhaustion and rejects partial, mixed or unbound evidence in SQL', async () => {
  const scope = { draftYear: 2012, draftType: 'mini_draft' };
  const closed = { captureId: 'closed', artifactId: 'closed-bytes', documentId: '453694' };
  const facts = [
    {
      evidenceId: 'capacity',
      captureId: 'rules',
      artifactId: 'rules-bytes',
      documentId: 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
      claim: { ...scope, kind: 'draft_selection_capacity', maximumSelections: 2 },
    },
    {
      ...closed,
      evidenceId: 'roster',
      claim: {
        ...scope,
        kind: 'draft_completed_membership_roster',
        members: [
          { recordedName: 'Jack Martin', selectionNumber: 1 },
          { recordedName: 'Jesse Hogan', selectionNumber: 2 },
        ],
      },
    },
    {
      ...closed,
      evidenceId: 'completion',
      claim: { ...scope, kind: 'draft_session_completion', sessionOrdinal: 1 },
    },
    {
      ...closed,
      evidenceId: 'first',
      claim: {
        ...scope,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Jack Martin' },
        selectedByClub: { nativeId: null, recordedName: 'Gold Coast Suns' },
      },
    },
    {
      ...closed,
      evidenceId: 'last',
      claim: {
        ...scope,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 2,
        player: { nativeId: null, recordedName: 'Jesse Hogan' },
        selectedByClub: { nativeId: null, recordedName: 'Melbourne' },
      },
    },
  ];
  const check = async (
    value: unknown,
    expected: unknown = [1, 2],
    year = 2012,
    type = 'mini_draft'
  ) =>
    (
      await pool.query(
        'SELECT outcome_completed_capacity_exhaustion_exact($1::jsonb,$2::jsonb,$3,$4) AS valid',
        [JSON.stringify(value), JSON.stringify(expected), year, type]
      )
    ).rows[0].valid;
  expect(await check(facts)).toBe(true);
  expect(await check(facts.slice(0, 4))).toBe(false);
  expect(await check([...facts, facts[0]])).toBe(false);
  expect(await check(facts, [1])).toBe(false);
  expect(await check(facts, [1, 1])).toBe(false);
  expect(await check(facts, [1, 2], 2011)).toBe(false);
  expect(await check(facts, [1, 2], 2012, 'national')).toBe(false);
  const patches: Array<[string[], unknown]> = [
    [['0', 'claim', 'maximumSelections'], 3],
    [['0', 'claim', 'kind'], 'draft_completed_total'],
    [['0', 'captureId'], 'closed'],
    [['0', 'artifactId'], 'closed-bytes'],
    [['0', 'documentId'], '453694'],
    [['1', 'claim', 'members', '1', 'selectionNumber'], 1],
    [['1', 'claim', 'members', '1', 'recordedName'], 'Jack Martin'],
    [['2', 'captureId'], 'unbound'],
    [['2', 'artifactId'], 'unbound'],
    [['2', 'claim', 'sessionOrdinal'], 2],
    [['3', 'documentId'], 'other'],
    [['3', 'claim', 'player', 'recordedName'], 'Other player'],
    [['4', 'claim', 'boundary'], 'first'],
    [['4', 'claim', 'selectionNumber'], 3],
    [['4', 'evidenceId'], 'first'],
  ];
  for (const [path, value] of patches) {
    expect(
      (
        await pool.query(
          `SELECT outcome_completed_capacity_exhaustion_exact(jsonb_set($1::jsonb,$2::text[],$3::jsonb),$4::jsonb,2012,'mini_draft') AS valid`,
          [JSON.stringify(facts), path, JSON.stringify(value), '[1,2]']
        )
      ).rows[0].valid
    ).toBe(false);
  }
});

it('validates independent2010 list populations and rejects incomplete or altered proofs', async () => {
  const scope = { draftYear: 2010, draftType: 'national' };
  const fact = (id: string, documentId: string, claim: object) => ({
    evidenceId: id,
    captureId: id,
    artifactId: id + '-bytes',
    documentId,
    claim: { ...scope, ...claim },
  });
  const facts = [
    fact(
      'total',
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf',
      {
        kind: 'draft_completed_list_total',
        population: 'national_selections_and_rookie_promotions',
        playerCount: 4,
      }
    ),
    fact('additions', '114795', {
      kind: 'draft_rookie_list_additions',
      clubs: [{ recordedClub: 'ADELAIDE', recordedNames: ['One', 'Two'] }],
    }),
    fact('slots', '469544', {
      kind: 'draft_rookie_promotion_slots',
      clubs: [{ recordedClub: 'Adelaide Crows', selectionNumbers: [2, 4] }],
    }),
  ];
  const check = async (value: unknown, expected: unknown = [1, 3], year = 2010) =>
    (
      await pool.query(
        "SELECT outcome_completed_list_population_exact($1::jsonb,$2::jsonb,$3,'national') AS valid",
        [JSON.stringify(value), JSON.stringify(expected), year]
      )
    ).rows[0].valid;
  expect(await check(facts)).toBe(true);
  for (const value of [facts.slice(1), [...facts, facts[0]], [], null])
    expect(await check(value)).toBe(false);
  for (const expected of [[1], [1, 1], [1, 2], [1, '3'], [1, 3.5], null])
    expect(await check(facts, expected)).toBe(false);
  expect(await check(facts, [1, 3], 2011)).toBe(false);
  const patches: Array<[string[], unknown]> = [
    [['0', 'claim', 'playerCount'], 5],
    [['0', 'claim', 'playerCount'], '4'],
    [['0', 'claim', 'selectionCount'], 2],
    [['0', 'claim', 'population'], 'all_lists'],
    [['1', 'claim', 'draftYear'], 2011],
    [['1', 'claim', 'clubs'], []],
    [
      ['1', 'claim', 'clubs', '0', 'recordedNames'],
      ['One', 'One'],
    ],
    [['1', 'claim', 'clubs', '0', 'recordedNames'], ['One']],
    [['1', 'claim', 'clubs', '0', 'recordedClub'], 'Adelaide'],
    [
      ['2', 'claim', 'clubs', '0', 'selectionNumbers'],
      [2, 2],
    ],
    [
      ['2', 'claim', 'clubs', '0', 'selectionNumbers'],
      [2, '4'],
    ],
    [
      ['2', 'claim', 'clubs', '0', 'selectionNumbers'],
      [2, 3],
    ],
    [['2', 'claim', 'clubs', '0', 'extra'], true],
    [['1', 'documentId'], 'other'],
    [['1', 'captureId'], 'total'],
    [['1', 'artifactId'], 'total-bytes'],
    [['1', 'evidenceId'], 'total'],
  ];
  for (const [path, value] of patches)
    expect(
      (
        await pool.query(
          "SELECT outcome_completed_list_population_exact(jsonb_set($1::jsonb,$2::text[],$3::jsonb), '[1,3]',2010,'national') AS valid",
          [JSON.stringify(facts), path, JSON.stringify(value)]
        )
      ).rows[0].valid,
      path.join('.')
    ).toBe(false);
});

it('reconstructs the2010 numbered union and member identity without a reported-last claim', async () => {
  const scope = { draftYear: 2010, draftType: 'national' };
  const fact = (id: string, documentId: string, claim: object, captureId = id) => ({
    evidenceId: id,
    captureId,
    artifactId: captureId + '-bytes',
    documentId,
    claim: { ...scope, ...claim },
  });
  const clubUrl = 'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are';
  const expected = [...Array.from({ length: 77 }, (_, i) => i + 1), 103, 104];
  const facts = [
    fact(
      'total',
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf',
      {
        kind: 'draft_completed_list_total',
        population: 'national_selections_and_rookie_promotions',
        playerCount: 107,
      }
    ),
    fact('additions', '114795', {
      kind: 'draft_rookie_list_additions',
      clubs: [
        { recordedClub: 'A', recordedNames: Array.from({ length: 28 }, (_, i) => 'Rookie' + i) },
      ],
    }),
    fact('slots', '469544', {
      kind: 'draft_rookie_promotion_slots',
      clubs: [
        {
          recordedClub: 'A',
          selectionNumbers: [...Array.from({ length: 25 }, (_, i) => i + 78), 105, 106, 107],
        },
      ],
    }),
    ...Array.from({ length: 77 }, (_, i) =>
      fact(
        'member' + i,
        '469544',
        {
          kind: 'draft_completed_member_number',
          recordedName: 'Member' + i,
          selectionNumber: i + 1,
        },
        'slots'
      )
    ),
    fact('polo', '45435', {
      kind: 'draft_completed_member_number',
      recordedName: 'Dean Polo',
      selectionNumber: 103,
    }),
    fact('young', clubUrl, {
      kind: 'draft_completed_member_number',
      recordedName: 'Tom Young',
      selectionNumber: 104,
    }),
    fact(
      'identity',
      clubUrl,
      {
        kind: 'draft_session_member_identity',
        sessionOrdinal: 1,
        selectionNumber: 104,
        player: { nativeId: null, recordedName: 'Tom Young' },
        selectedByClub: { nativeId: null, recordedName: 'Collingwood' },
      },
      'young'
    ),
  ];
  const check = async (value: unknown, numbers: unknown = expected) =>
    (
      await pool.query(
        'SELECT outcome_completed_numbered_union_exact($1::jsonb,$2::jsonb) AS valid',
        [JSON.stringify(value), JSON.stringify(numbers)]
      )
    ).rows[0].valid;
  expect(await check(facts)).toBe(true);
  expect(await check(facts.slice(1))).toBe(false);
  expect(await check([...facts, facts[82]])).toBe(false);
  expect(await check(facts, expected.slice(1))).toBe(false);
  const patches: Array<[string[], unknown]> = [
    [['0', 'claim', 'playerCount'], 108],
    [['3', 'captureId'], 'unbound'],
    [['3', 'artifactId'], 'unbound'],
    [['3', 'claim', 'recordedName'], 'Member1'],
    [['3', 'claim', 'selectionNumber'], 2],
    [['80', 'documentId'], '469544'],
    [['80', 'claim', 'recordedName'], 'Other'],
    [['81', 'artifactId'], 'polo-bytes'],
    [['81', 'claim', 'selectionNumber'], 105],
    [['82', 'claim', 'player', 'recordedName'], 'Other'],
    [['82', 'claim', 'selectedByClub', 'recordedName'], 'Other'],
    [['82', 'claim', 'boundary'], 'last'],
    [['82', 'claim', 'sessionOrdinal'], 2],
    [['82', 'captureId'], 'slots'],
    [['82', 'artifactId'], 'slots-bytes'],
    [['82', 'documentId'], 'other'],
    [['82', 'evidenceId'], 'young'],
    [['82', 'claim', 'kind'], 'draft_session_boundary'],
  ];
  for (const [path, value] of patches)
    expect(
      (
        await pool.query(
          'SELECT outcome_completed_numbered_union_exact(jsonb_set($1::jsonb,$2::text[],$3::jsonb),$4::jsonb) AS valid',
          [JSON.stringify(facts), path, JSON.stringify(value), JSON.stringify(expected)]
        )
      ).rows[0].valid,
      path.join('.')
    ).toBe(false);
});

it('authenticates derived2010 inventory and rejects revoked terminal identities', async () => {
  const candidateId = 'derived2010-fixture';
  const scope = { draftYear: 2010, draftType: 'national' };
  const numbers = [...Array.from({ length: 77 }, (_, i) => i + 1), 103, 104];
  const urls = [
    'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf',
    'https://www.afl.com.au/news/114795/countdown-to-d-day',
    'https://www.afl.com.au/news/469544/round-by-round-selections',
    'https://www.afl.com.au/news/45435/polo-prepared-for-different-roles',
    'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are',
  ];
  const facts: Array<{ capture: number; claim: any }> = [
    {
      capture: 0,
      claim: {
        ...scope,
        kind: 'draft_completed_list_total',
        population: 'national_selections_and_rookie_promotions',
        playerCount: 107,
      },
    },
    {
      capture: 1,
      claim: {
        ...scope,
        kind: 'draft_rookie_list_additions',
        clubs: [
          { recordedClub: 'A', recordedNames: Array.from({ length: 28 }, (_, i) => 'Rookie' + i) },
        ],
      },
    },
    {
      capture: 2,
      claim: {
        ...scope,
        kind: 'draft_rookie_promotion_slots',
        clubs: [
          {
            recordedClub: 'A',
            selectionNumbers: [...Array.from({ length: 25 }, (_, i) => i + 78), 105, 106, 107],
          },
        ],
      },
    },
    ...Array.from({ length: 77 }, (_, i) => ({
      capture: 2,
      claim: {
        ...scope,
        kind: 'draft_completed_member_number',
        recordedName: 'Member' + i,
        selectionNumber: i + 1,
      },
    })),
    {
      capture: 3,
      claim: {
        ...scope,
        kind: 'draft_completed_member_number',
        recordedName: 'Dean Polo',
        selectionNumber: 103,
      },
    },
    {
      capture: 4,
      claim: {
        ...scope,
        kind: 'draft_completed_member_number',
        recordedName: 'Tom Young',
        selectionNumber: 104,
      },
    },
    {
      capture: 4,
      claim: {
        ...scope,
        kind: 'draft_session_member_identity',
        sessionOrdinal: 1,
        selectionNumber: 104,
        player: { nativeId: null, recordedName: 'Tom Young' },
        selectedByClub: { nativeId: null, recordedName: 'Collingwood' },
      },
    },
    {
      capture: 4,
      claim: { ...scope, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2010-11-18' },
    },
    { capture: 4, claim: { ...scope, kind: 'draft_session_completion', sessionOrdinal: 1 } },
    {
      capture: 2,
      claim: {
        ...scope,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'First' },
        selectedByClub: { nativeId: null, recordedName: 'First Club' },
      },
    },
  ];
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const evidenceIds = facts.map((_, i) => 'external-evidence:' + hash('derived2010:' + i));
  const batches = urls.map((_, i) => 'external-evidence-batch:' + hash('derived2010-batch:' + i));
  const doc = {
    candidateId,
    content: { environment: 'test_fixture', competition: 'AFLM', sourceBatchIds: batches },
  };
  const inventory = numbers.map((n) => ({
    candidate_id: candidateId,
    selection_id: 'derived-selection:' + n,
    draft_year: 2010,
    draft_type: 'national',
    selection_number: n,
    selection_json: {
      playerId: 'player:' + n,
      clubId: 'club:' + n,
      evidenceIds: [...evidenceIds].sort(),
    },
  }));
  const identities = [
    ['player', 'First', 'player:1'],
    ['club', 'First Club', 'club:1'],
    ['player', 'Tom Young', 'player:104'],
    ['club', 'Collingwood', 'club:104'],
  ].map(([kind, recordedName, canonicalId], i) => ({
    content: {
      provider: 'official_afl',
      entityKind: kind,
      canonicalId,
      sourceIdentity: { nativeId: null, recordedName },
      reviewDecisionId: 'review-decision:' + hash('derived2010-review:' + i),
    },
  }));
  const proposal = {
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
    proposedAt: '2026-09-14T00:00:00Z',
    draftEventCoverage: [
      {
        draftYear: 2010,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2010-11-18',
        officialName: '2010 fixture',
        expectedSelectionCount: 79,
        selectionIds: inventory.map((s) => s.selection_id),
        evidenceIds: [...evidenceIds].sort(),
        status: 'complete',
        proofKind: 'combined_session_facts',
      },
    ],
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    for (const [i, url] of urls.entries()) {
      const capture = 'source-capture:' + hash('derived2010-capture:' + i);
      await client.query(
        `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json) VALUES($1,$2,$3,$4,'test_fixture','official_afl','draft-session','fixture','automated_web','official-afl-completed-draft-session','AFLM',2010,'2026-09-13','2026-09-13','approved',$5::jsonb)`,
        [
          capture,
          'derived-attempt:' + i,
          'derived-snapshot:' + i,
          'artifact:' + hash('derived2010-bytes:' + i),
          JSON.stringify({ sourceUrl: url }),
        ]
      );
      await client.query(
        `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json) VALUES($1,$2,'official_afl',$3,0,$4,$4,'finalized','2026-09-13','{}')`,
        [batches[i], capture, facts.filter((f) => f.capture === i).length, hash('derived-row:' + i)]
      );
    }
    for (const [i, f] of facts.entries())
      await client.query(
        `INSERT INTO outcome_external_evidence_row(evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          evidenceIds[i],
          batches[f.capture],
          i + 1,
          'derived:' + i,
          f.claim.kind,
          JSON.stringify({ content: { provider: 'official_afl', claim: f.claim } }),
        ]
      );
    for (const identity of identities) {
      const content = identity.content;
      const observations = facts.flatMap((fact, i) => {
        const claim = fact.claim as Record<string, unknown>;
        const sourceIdentity = claim[content.entityKind === 'player' ? 'player' : 'selectedByClub'];
        return JSON.stringify(sourceIdentity) === JSON.stringify(content.sourceIdentity)
          ? [{ evidenceId: evidenceIds[i], seasonYear: 2010, sourceIdentity }]
          : [];
      });
      expect(observations).toHaveLength(1);
      const decisionDocument = { content: {
        decision: 'approved', subject: { content: { provider: 'official_afl', entityKind: content.entityKind,
          identityScope: { kind: 'exact_recorded_name', recordedName: content.sourceIdentity.recordedName, seasonYear: 2010 } } },
        canonicalTarget: { entityKind: content.entityKind, canonicalId: content.canonicalId },
        workItem: { content: { observations } },
      } };
      await client.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'external_identity','fixture','approved','fixture','{}','fixture','2026-09-13')`,
        [content.reviewDecisionId]
      );
      // Direct SQL inventory fixture: typed observations are required even with setup triggers disabled.
      const digest = content.reviewDecisionId.split(':')[1];
      await client.query(`INSERT INTO outcome_external_identity_review_decision
        (decision_id,subject_id,historical_completion_id,review_package_id,work_item_id,work_item_sha256,
         work_item_canonical_json,revision,outcome,canonical_target_kind,canonical_target_id,
         canonical_target_snapshot_sha256,canonical_target_canonical_json,authority_evidence_id,
         supersedes_decision_id,decision_sha256,decision_canonical_json,decision_json,decided_at)
        VALUES($1,$1,'fixture',$2,$3,$4,'{}',1,'approved',$5,$6,$4,'{}','fixture',NULL,$4,$7::text,($7::text)::jsonb,'2026-09-13')`,
        [content.reviewDecisionId, 'external-identity-review-package:' + digest,
          'external-identity-review-work-item:' + digest, digest, content.entityKind, content.canonicalId, JSON.stringify(decisionDocument)]);
      const evidenceIndex = evidenceIds.indexOf(observations[0]!.evidenceId);
      const evidenceDocument = { content: { provider: 'official_afl', claim: facts[evidenceIndex]!.claim } };
      const matches = async (decision: unknown, evidenceKey = observations[0]!.evidenceId) =>
        (await client.query('SELECT outcome_session_identity_observation_matches($1::jsonb,$2::jsonb,$3,$4,$5) AS valid',
          [JSON.stringify(decision), JSON.stringify(evidenceDocument), evidenceKey, content.entityKind, content.canonicalId])).rows[0].valid;
      expect(await matches(decisionDocument)).toBe(true);
      const wrongSeason = structuredClone(decisionDocument);
      wrongSeason.content.subject.content.identityScope.seasonYear = 2012;
      expect(await matches(wrongSeason)).toBe(false);
      expect(await matches(decisionDocument, 'external-evidence:' + hash('wrong-observation'))).toBe(false);
      const wrongObservationSeason = structuredClone(decisionDocument);
      wrongObservationSeason.content.workItem.content.observations[0]!.seasonYear = 2012;
      expect(await matches(wrongObservationSeason)).toBe(false);
    }
    await client.query('SET LOCAL session_replication_role=origin');
    const check = async (owner: string) =>
      (
        await client.query(
          `SELECT ${owner}($1,$2::jsonb,2010,'national',$3::jsonb,$4::jsonb,$5::jsonb) AS valid`,
          [
            candidateId,
            JSON.stringify({
              ...proposal,
              schemaVersion: owner.includes('_window_')
                ? 'afl-trade-external-canonical-promotion-proposal/v7'
                : proposal.schemaVersion,
            }),
            JSON.stringify(doc),
            JSON.stringify(inventory),
            JSON.stringify(identities),
          ]
        )
      ).rows[0].valid;
    expect(await check('outcome_external_combined_draft_group_exact_inventory')).toBe(true);
    expect(await check('outcome_external_window_draft_group_exact_inventory')).toBe(true);
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query(
      "UPDATE outcome_review_decision SET decision='rejected' WHERE decision_id=$1",
      [identities[3].content.reviewDecisionId]
    );
    await client.query('SET LOCAL session_replication_role=origin');
    expect(await check('outcome_external_combined_draft_group_exact_inventory')).toBe(false);
    expect(await check('outcome_external_window_draft_group_exact_inventory')).toBe(false);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

it('limits2010 source keys to the exact reviewed URLs, year and pathway', async () => {
  const sources = [
    ['https://www.afl.com.au/news/114795/countdown-to-d-day', '114795'],
    ['https://www.afl.com.au/news/469544/round-by-round-selections', '469544'],
    ['https://www.afl.com.au/news/45435/polo-prepared-for-different-roles', '45435'],
    ['https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are', null],
    [
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf',
      null,
    ],
  ];
  for (const [url, key] of sources) {
    const get = async (u: any, year = 2010, type = 'national') =>
      (
        await pool.query('SELECT outcome_official_mini_2011_document_key($1,$2,$3) AS key', [
          u,
          year,
          type,
        ])
      ).rows[0].key;
    expect(await get(url)).toBe(key ?? url);
    expect(await get(url, 2011)).toBeNull();
    expect(await get(url, 2010, 'rookie')).toBeNull();
    expect(await get(url + '?x=1')).toBeNull();
  }
});
