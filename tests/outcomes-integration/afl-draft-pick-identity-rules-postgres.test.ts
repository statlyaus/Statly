import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress as address,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0273 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md):
 * finalization refuses a candidate in which one `draft-pick:` id stands for two picks, naming the
 * rule, and accepts the lawful shapes a pick takes. Each case is a hand-built candidate whose every
 * record cites the one retained source row, so only the rule under test can refuse it.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0273_draft_pick_identity_rules';
const schema = `draft_pick_identity_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
let history: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;

const digest = (character: string) => character.repeat(64);
const batchId = `external-evidence-batch:${digest('b')}`;
const captureId = `source-capture:${digest('c')}`;
const evidence = createAflTradeExternalEvidenceEnvelope({
  schemaVersion: 'afl-trade-external-evidence/v1',
  provider: 'draftguru',
  publicationEligible: false,
  capture: {
    captureId,
    artifactId: `artifact:${digest('1')}`,
    contentSha256: digest('1'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/trades/pick-identity-fixture',
    capturedAt: '2025-11-01T00:00:00.000Z',
    effectiveAt: '2025-11-01T00:00:00.000Z',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: digest('4'),
  },
  sourceRow: { ordinal: 1, sourceKey: 'fixture-trade' },
  claim: {
    kind: 'transaction',
    nativeEventId: 'pick-identity-fixture',
    seasonYear: 2025,
    occurredOn: null,
    transactionType: 'trade',
    title: null,
  },
});
const cited = [evidence.evidenceId];

const club = (name: string) => `club-${name}`;
const pick = (fields: Record<string, unknown>) => address('draft-pick', fields);
const entitlement = (original: string, roundNumber = 1) =>
  pick({ draftYear: 2025, draftType: 'national', roundNumber, originalClubId: club(original) });
const numberOnly = (nominalPick: number) =>
  pick({ draftYear: 2025, draftType: 'national', nominalPick, nominalRound: null });
const transactionId = (event: string) =>
  address('external-transaction', { provider: 'draftguru', nativeEventId: event });
const transferId = (event: string, leg: string) =>
  address('external-transfer', { transactionId: transactionId(event), nativeTransferId: leg });

interface Leg {
  event: string;
  leg: string;
  from: string;
  to: string;
  pickId: string;
  nominalPick: number | null;
  nominalRound?: number | null;
  original?: string | null;
}

/** A candidate of the given pick transfers, custody, selections and extras, all citing one row. */
function candidate(
  legs: Leg[],
  extra: {
    custody?: {
      pickId: string;
      original: string | null;
      holder: string;
      slot: number;
      status?: string;
    }[];
    selections?: { pickId: string; number: number; club: string; providers?: string[] }[];
    outcomes?: { transfer: Leg; playerId: string }[];
    boards?: { number: number; club: string; route: string[] }[];
    issues?: { subjectKey: string }[];
  } = {}
) {
  const events = [...new Set(legs.map(({ event }) => event))].sort();
  const transfers = legs.map((leg) => ({
    transferId: transferId(leg.event, leg.leg),
    transactionId: transactionId(leg.event),
    fromClubId: club(leg.from),
    toClubId: club(leg.to),
    asset: {
      kind: 'pick_entitlement' as const,
      pickId: leg.pickId,
      draftYear: 2025,
      draftType: 'national',
      nominalRound: leg.nominalRound ?? null,
      nominalPick: leg.nominalPick,
      originalClubId:
        leg.original === undefined || leg.original === null ? null : club(leg.original),
      recordedLabel: null,
    },
    status: 'single_source' as const,
    evidenceIds: cited,
  }));
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: events
      .map((event) => ({
        transactionId: transactionId(event),
        providerEventId: event,
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade' as const,
        title: null,
        parties: [
          ...new Set(
            legs
              .filter((leg) => leg.event === event)
              .flatMap(({ from, to }) => [club(from), club(to)])
          ),
        ].sort(),
        transferIds: transfers
          .filter(({ transactionId: id }) => id === transactionId(event))
          .map(({ transferId: id }) => id)
          .sort(),
        status: 'single_source' as const,
        evidenceIds: cited,
      }))
      .sort((left, right) => left.transactionId.localeCompare(right.transactionId)),
    transfers: transfers.sort((left, right) => left.transferId.localeCompare(right.transferId)),
    draftSelections: (extra.selections ?? []).map((selection) => ({
      selectionId: address('external-draft-selection', {
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: selection.number,
      }),
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: selection.number,
      roundNumber: null,
      pickId: selection.pickId,
      playerId: `player-${selection.number}`,
      clubId: club(selection.club),
      status: 'single_source' as const,
      supportingProviders: (selection.providers ?? ['draftguru']) as ['draftguru'],
      evidenceIds: cited,
    })),
    pickCustody: (extra.custody ?? [])
      .map((row, index) => ({
        custodyId: address('external-pick-custody', { fixture: index }),
        pickId: row.pickId,
        observedAt: '2025-11-07T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: row.slot,
        originalClubId: row.original === null ? null : club(row.original),
        currentClubId: club(row.holder),
        status: (row.status ?? 'single_source') as 'single_source',
        evidenceIds: cited,
      }))
      .sort((left, right) => left.custodyId.localeCompare(right.custodyId)),
    pickLineage: [],
    ...(extra.outcomes === undefined
      ? {}
      : {
          pickOutcomes: extra.outcomes
            .map(({ transfer, playerId }) => ({
              outcomeId: address('external-pick-outcome', {
                transferId: transferId(transfer.event, transfer.leg),
              }),
              transferId: transferId(transfer.event, transfer.leg),
              disposition: 'selected' as const,
              outcomeStatus: 'unresolved' as const,
              selectionId: null,
              playerId,
              evidenceIds: cited,
            }))
            .sort((left, right) => left.outcomeId.localeCompare(right.outcomeId)),
        }),
    ...(extra.boards === undefined
      ? {}
      : {
          draftBoardPicks: extra.boards.map((board) => ({
            boardPickId: address('external-draft-board-pick', { fixture: board.number }),
            draftYear: 2025,
            draftType: 'national',
            roundNumber: 1,
            recordedPickNumber: board.number,
            status: 'selected' as const,
            clubId: club(board.club),
            routeClubIds: board.route.map(club),
            evidenceIds: cited,
          })),
        }),
    issues: [
      ...(extra.outcomes === undefined
        ? []
        : [
            {
              code: 'pick_outcome_unresolved' as const,
              severity: 'blocking' as const,
              subjectKey: 'pick-outcome:fixture',
              detail: 'Fixture outcome.',
              evidenceIds: cited,
            },
          ]),
      ...(extra.issues ?? []).map(({ subjectKey }) => ({
        code: 'pick_identity_conflict' as const,
        severity: 'blocking' as const,
        subjectKey,
        detail: 'Fixture conflict.',
        evidenceIds: cited,
      })),
    ].sort((left, right) => left.subjectKey.localeCompare(right.subjectKey)),
    reconciledAt: '2026-10-12T11:00:00.000Z',
    publicationEligible: false,
  });
}

const persist = (record: ReturnType<typeof candidate>) =>
  new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
    candidate: record,
    identityResolutions: [],
  });
const refusal = (rule: number) =>
  expect.objectContaining({
    code: 'P0001',
    message: expect.stringContaining(`Pick-identity rule ${rule}:`),
  });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  const receipt = createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${digest('2')}`,
    gateDecisionId: `gate-decision:${digest('3')}`,
    gateDecisionKey: 'fixture:draftguru-trade-detail',
    ledgerRevision: 1,
    evaluatedAt: '2025-11-01T00:00:00.000Z',
    provider: 'draftguru',
    capabilityId: 'draftguru-trade-detail',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: digest('4'),
    upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${digest('5')}`,
  });
  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2025)`
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
      artifact_class,environment,created_at,verified_at,custody_json)
     VALUES ('artifact:${digest('1')}',$1,$2,'text/html',1,'raw_source','test_fixture',
      '2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`,
    [digest('1'), `artifact://sha256/${digest('1')}`]
  );
  await pool.query(`INSERT INTO outcome_source_capture_attempt
    (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
    VALUES ('attempt-pick-identity','test_fixture','draftguru','trades','draftguru-trade-detail',
      'captured','2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`);
  await pool.query(
    `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
      environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
      anchor_season_year,effective_at,captured_at,status,manifest_json)
     VALUES ($1,'attempt-pick-identity',$2,'artifact:${digest('1')}','test_fixture','draftguru','trades',
      '2025','automated_web','draftguru-trade-detail','AFLM',2025,'2025-10-15T00:00:00.000Z',
      '2025-11-01T00:00:01.000Z','approved',$3::jsonb)`,
    [
      captureId,
      `source-snapshot:${digest('2')}`,
      canonicalizeAflTradeJson({
        sourceUrl: 'https://www.draftguru.com.au/trades/pick-identity-fixture',
        executionReceipt: receipt,
      }),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,
      row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}'::jsonb)`,
    [batchId, captureId, sha256AflTradeCanonicalJson([evidence.evidenceId]), digest('0')]
  );
  await pool.query(
    `INSERT INTO outcome_external_evidence_row (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
     VALUES ($1,$2,1,'fixture-trade','transaction',$3::jsonb)`,
    [evidence.evidenceId, batchId, canonicalizeAflTradeJson(evidence)]
  );
  await pool.query(
    `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2025-11-01T00:00:02.000Z'
      WHERE batch_id=$1`,
    [batchId]
  );
}, 300_000);

afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

// One exchange moving Port Adelaide's first-round pick twice, as the 2025 Petracca trade was keyed.
const twice = candidate([
  {
    event: 'petracca',
    leg: 'a',
    from: 'gold-coast',
    to: 'melbourne',
    pickId: entitlement('port-adelaide'),
    nominalPick: 7,
  },
  {
    event: 'petracca',
    leg: 'b',
    from: 'gold-coast',
    to: 'melbourne',
    pickId: entitlement('port-adelaide'),
    nominalPick: 8,
  },
]);

describe('draft-pick identity rules at finalization (migration 0273)', () => {
  it('binds new candidates only: a candidate finalized before 0273 stays finalized', async () => {
    await expect(persist(twice)).resolves.toMatchObject({ status: 'finalized' });
    await pool.query(history.migrationSql);
    expect(
      (
        await pool.query<{ status: string }>(
          `SELECT status FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
          [twice.candidateId]
        )
      ).rows[0]
    ).toEqual({ status: 'finalized' });
    // Replaying the stored candidate is idempotent; the rule binds the open-to-finalized transition.
    await expect(persist(twice)).resolves.toMatchObject({ idempotentReplay: true });
  });

  it('rule 1: refuses one exchange moving a pick twice, accepts one pick through three clubs', async () => {
    await expect(
      persist(
        candidate([
          {
            event: 'swap',
            leg: 'a',
            from: 'carlton',
            to: 'west-coast',
            pickId: entitlement('carlton'),
            nominalPick: 10,
          },
          {
            event: 'swap',
            leg: 'b',
            from: 'carlton',
            to: 'west-coast',
            pickId: entitlement('carlton'),
            nominalPick: 11,
          },
        ])
      )
    ).rejects.toEqual(refusal(1));
    await expect(
      persist(
        candidate([
          {
            event: 'three',
            leg: 'a',
            from: 'carlton',
            to: 'west-coast',
            pickId: entitlement('carlton'),
            nominalPick: 10,
          },
          {
            event: 'three',
            leg: 'b',
            from: 'west-coast',
            to: 'richmond',
            pickId: entitlement('carlton'),
            nominalPick: 10,
          },
        ])
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('rule 1: accepts a pick swapped back on draft night and a renumbered entitlement', async () => {
    await expect(
      persist(
        candidate([
          {
            event: 'there',
            leg: 'a',
            from: 'carlton',
            to: 'essendon',
            pickId: entitlement('carlton', 2),
            nominalPick: 30,
            nominalRound: 2,
          },
          {
            event: 'back',
            leg: 'a',
            from: 'essendon',
            to: 'carlton',
            pickId: entitlement('carlton', 2),
            nominalPick: 27,
            nominalRound: 2,
          },
        ])
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('rule 2: refuses two original clubs on one pick, ignores a pick with none', async () => {
    const id = entitlement('western-bulldogs', 3);
    await expect(
      persist(
        candidate(
          [
            {
              event: 'merge',
              leg: 'a',
              from: 'brisbane',
              to: 'gold-coast',
              pickId: id,
              nominalPick: 47,
              original: 'brisbane',
            },
          ],
          { custody: [{ pickId: id, original: 'western-bulldogs', holder: 'essendon', slot: 54 }] }
        )
      )
    ).rejects.toEqual(refusal(2));
    const special = pick({ unresolvedCustodyId: 'fixture' });
    await expect(
      persist(
        candidate(
          [
            {
              event: 'special',
              leg: 'a',
              from: 'gold-coast',
              to: 'carlton',
              pickId: special,
              nominalPick: 2,
              original: null,
            },
          ],
          {
            custody: [
              { pickId: special, original: null, holder: 'carlton', slot: 2, status: 'unresolved' },
            ],
          }
        )
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('rule 3: refuses two drafted players on one pick, accepts a future pick numbered later', async () => {
    const legs: Leg[] = [
      {
        event: 'first',
        leg: 'a',
        from: 'gold-coast',
        to: 'melbourne',
        pickId: entitlement('port-adelaide'),
        nominalPick: 7,
      },
      {
        event: 'second',
        leg: 'a',
        from: 'melbourne',
        to: 'st-kilda',
        pickId: entitlement('port-adelaide'),
        nominalPick: 7,
      },
    ];
    await expect(
      persist(
        candidate(legs, {
          outcomes: [
            { transfer: legs[0]!, playerId: 'player-taylor' },
            { transfer: legs[1]!, playerId: 'player-pickett' },
          ],
        })
      )
    ).rejects.toEqual(refusal(3));
    const later: Leg[] = [
      {
        event: 'future',
        leg: 'a',
        from: 'hawthorn',
        to: 'adelaide',
        pickId: entitlement('hawthorn', 4),
        nominalPick: null,
        nominalRound: 4,
        original: 'hawthorn',
      },
      {
        event: 'night',
        leg: 'a',
        from: 'adelaide',
        to: 'port-adelaide',
        pickId: entitlement('hawthorn', 4),
        nominalPick: 62,
        original: 'hawthorn',
      },
    ];
    await expect(
      persist(candidate(later, { outcomes: [{ transfer: later[1]!, playerId: 'player-jackson' }] }))
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('rule 4: refuses two selections on one pick through the unique index', async () => {
    const id = entitlement('sydney');
    await expect(
      persist(
        candidate(
          [
            {
              event: 'one',
              leg: 'a',
              from: 'sydney',
              to: 'port-adelaide',
              pickId: id,
              nominalPick: 12,
            },
          ],
          {
            selections: [
              { pickId: id, number: 12, club: 'port-adelaide' },
              { pickId: id, number: 14, club: 'west-coast' },
            ],
          }
        )
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rule 5: refuses an off-route transfer on a routed selected pick unless its conflict is recorded', async () => {
    const id = pick({
      draftYear: 2025,
      draftType: 'national',
      eventualSelection: { provider: 'draftguru', playerNativeId: 'x' },
    });
    const legs: Leg[] = [
      { event: 'off', leg: 'a', from: 'gold-coast', to: 'carlton', pickId: id, nominalPick: 22 },
      { event: 'on', leg: 'a', from: 'carlton', to: 'brisbane', pickId: id, nominalPick: 22 },
    ];
    const extra = {
      selections: [{ pickId: id, number: 22, club: 'brisbane' }],
      boards: [{ number: 22, club: 'brisbane', route: ['richmond', 'carlton', 'brisbane'] }],
    };
    await expect(persist(candidate(legs, extra))).rejects.toEqual(refusal(5));
    await expect(
      persist(candidate(legs, { ...extra, issues: [{ subjectKey: `pick-custody:${id}` }] }))
    ).resolves.toMatchObject({ status: 'finalized' });
    // On the route, or a selection only Footyinfo states, is not checked.
    await expect(
      persist(
        candidate(legs, {
          ...extra,
          boards: [{ number: 22, club: 'brisbane', route: ['gold-coast', 'carlton', 'brisbane'] }],
        })
      )
    ).resolves.toMatchObject({ status: 'finalized' });
    await expect(
      persist(
        candidate(legs, {
          ...extra,
          selections: [{ pickId: id, number: 22, club: 'brisbane', providers: ['footyinfo'] }],
        })
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('rule 6: refuses a number-only id across trades or with a selection, accepts transfer-scoped numbers', async () => {
    await expect(
      persist(
        candidate([
          {
            event: 'x',
            leg: 'a',
            from: 'carlton',
            to: 'west-coast',
            pickId: numberOnly(30),
            nominalPick: 30,
          },
          {
            event: 'y',
            leg: 'a',
            from: 'richmond',
            to: 'essendon',
            pickId: numberOnly(30),
            nominalPick: 30,
          },
        ])
      )
    ).rejects.toEqual(refusal(6));
    await expect(
      persist(
        candidate(
          [
            {
              event: 'z',
              leg: 'a',
              from: 'richmond',
              to: 'essendon',
              pickId: numberOnly(31),
              nominalPick: 31,
            },
          ],
          {
            selections: [{ pickId: numberOnly(31), number: 31, club: 'essendon' }],
          }
        )
      )
    ).rejects.toEqual(refusal(6));
    const scoped = (leg: string) =>
      pick({
        draftYear: 2025,
        draftType: 'national',
        nominalPick: 30,
        nominalRound: null,
        transferEvidenceId: leg,
      });
    await expect(
      persist(
        candidate(
          [
            {
              event: 'x',
              leg: 'a',
              from: 'carlton',
              to: 'west-coast',
              pickId: scoped('x'),
              nominalPick: 30,
            },
            {
              event: 'y',
              leg: 'a',
              from: 'richmond',
              to: 'essendon',
              pickId: scoped('y'),
              nominalPick: 30,
            },
          ],
          { selections: [{ pickId: numberOnly(30), number: 30, club: 'essendon' }] }
        )
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });

  it('accepts a future-pick trade of a disputed entitlement, each transfer on its own id', async () => {
    const disputed = entitlement('carlton', 2);
    const scoped = (leg: string) =>
      pick({
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 2,
        originalClubId: club('carlton'),
        disputedTransferEvidenceId: leg,
      });
    await expect(
      persist(
        candidate(
          [
            {
              event: 'both',
              leg: 'a',
              from: 'carlton',
              to: 'west-coast',
              pickId: scoped('a'),
              nominalPick: null,
              nominalRound: 2,
              original: 'carlton',
            },
            {
              event: 'both',
              leg: 'b',
              from: 'carlton',
              to: 'west-coast',
              pickId: scoped('b'),
              nominalPick: null,
              nominalRound: 2,
              original: 'carlton',
            },
          ],
          {
            custody: [
              {
                pickId: disputed,
                original: 'carlton',
                holder: 'carlton',
                slot: 20,
                status: 'disputed',
              },
              {
                pickId: disputed,
                original: 'carlton',
                holder: 'carlton',
                slot: 25,
                status: 'disputed',
              },
            ],
          }
        )
      )
    ).resolves.toMatchObject({ status: 'finalized' });
  });
});
